// ==UserScript==
// @name         RestockIQ
// @namespace    RestockIQ
// @version      0.8.2
// @description  TornPDA City Shop Restock & Value Monitor
// @match        *://www.torn.com/*
// @match        *://torn.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const VERSION = '0.8.2';

    const BUTTON_ID = 'restockiq-button';
    const WRAPPER_ID = 'restockiq-nav-wrapper';
    const PANEL_ID = 'restockiq-panel';

    const KEY_STORAGE = 'restockiq_api_key';
    const HISTORY_STORAGE = 'restockiq_history_v1';
    const SHOP_STORAGE = 'restockiq_enabled_shops_v1';
    const ITEM_STORAGE = 'restockiq_watched_items_v1';
    const MV_STORAGE = 'restockiq_market_values_v1';

    const CITYSHOPS_API =
        'https://api.torn.com/v2/torn/cityshops';

    const ITEMS_API =
        'https://api.torn.com/v2/torn/items?cat=All&sort=ASC';

    const AUTO_CHECK_MS = 60 * 1000;
    const MV_REFRESH_MS = 15 * 60 * 1000;

    const DEFAULT_SHOPS = [
        "Bits 'n' Bobs",
        'Pharmacy',
        'Sweet Shop',
        "Big Al's Gun Shop"
    ];

    const DEFAULT_ITEMS = [
        'Bottle of Beer',
        'Empty Blood Bag'
    ];

    const SHOP_URLS = {
        "Bits 'n' Bobs":
            'https://www.torn.com/shops.php?step=bitsnbobs',

        "Big Al's Gun Shop":
            'https://www.torn.com/bigalgunshop.php',

        'Pharmacy':
            'https://www.torn.com/shops.php?step=pharmacy',

        'Sweet Shop':
            'https://www.torn.com/shops.php?step=candy',

        "Sally's Sweet Shop":
            'https://www.torn.com/shops.php?step=candy'
    };

    let cityShops = [];
    let latestItems = [];

    let checking = false;
    let marketChecking = false;
    let lastSuccessfulCheck = 0;

    function getApiKey() {
        return localStorage.getItem(KEY_STORAGE) || '';
    }

    function saveApiKey(key) {
        localStorage.setItem(KEY_STORAGE, key.trim());
    }

    function readJSON(key, fallback) {
        try {
            const value = localStorage.getItem(key);
            if (!value) return fallback;
            return JSON.parse(value);
        } catch (error) {
            return fallback;
        }
    }

    function writeJSON(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (error) {
            console.log('[RestockIQ Storage Error]', error);
        }
    }

    function getEnabledShops() {
        const saved = readJSON(SHOP_STORAGE, null);
        return Array.isArray(saved) ? saved : DEFAULT_SHOPS.slice();
    }

    function saveEnabledShops(shops) { writeJSON(SHOP_STORAGE, shops); }

    function getWatchedItems() {
        const saved = readJSON(ITEM_STORAGE, null);
        return Array.isArray(saved) ? saved : DEFAULT_ITEMS.slice();
    }

    function saveWatchedItems(items) { writeJSON(ITEM_STORAGE, items); }
    function getHistory() { return readJSON(HISTORY_STORAGE, {}); }
    function saveHistory(history) { writeJSON(HISTORY_STORAGE, history); }

    function getMarketCache() {
        return readJSON(MV_STORAGE, { updated: 0, values: {} });
    }

    function saveMarketCache(cache) { writeJSON(MV_STORAGE, cache); }

    function getMarketValue(itemId) {
        const cache = getMarketCache();
        if (!cache.values || cache.values[String(itemId)] == null) return null;
        const value = Number(cache.values[String(itemId)]);
        return Number.isFinite(value) ? value : null;
    }

    function getSearchButton() {
        return document.querySelector('button[aria-label="Open global search"]');
    }

    function makeButton() {
        if (document.getElementById(WRAPPER_ID)) return;
        const search = getSearchButton();
        if (!search) return;
        const searchLI = search.closest('li');
        if (!searchLI || !searchLI.parentElement) return;
        const toolbar = searchLI.parentElement;
        const wrapper = document.createElement('li');
        wrapper.id = WRAPPER_ID;
        wrapper.style.cssText = ['display:flex','align-items:center','justify-content:center','width:34px','height:34px','min-width:34px','padding:0','margin:0','background:transparent','position:relative','z-index:999999','visibility:visible','opacity:1','box-sizing:border-box','list-style:none'].join(';');
        const button = document.createElement('button');
        button.id = BUTTON_ID;
        button.type = 'button';
        button.setAttribute('aria-label', 'Open RestockIQ');
        button.setAttribute('title', 'RestockIQ');
        button.style.cssText = ['display:flex','align-items:center','justify-content:center','position:relative','width:34px','height:34px','padding:0','margin:0','border:0','outline:0','background:transparent','color:#8f8f8f','visibility:visible','opacity:1','box-sizing:border-box','cursor:pointer','z-index:999999'].join(';');
        const dollar = document.createElement('span');
        dollar.textContent = '$';
        dollar.style.cssText = ['font-family:Arial,sans-serif','font-size:24px','font-weight:bold','line-height:1','color:#8f8f8f','pointer-events:none','transform:translateY(-1px)'].join(';');
        const dot = document.createElement('span');
        dot.id = 'restockiq-dot';
        dot.style.cssText = ['display:none','position:absolute','top:1px','right:1px','width:7px','height:7px','background:#55d878','border-radius:50%','border:1px solid #111','box-sizing:border-box','pointer-events:none'].join(';');
        button.appendChild(dollar); button.appendChild(dot); wrapper.appendChild(button);
        toolbar.insertBefore(wrapper, searchLI); toolbar.style.overflow = 'visible';
        button.addEventListener('click', function (event) { event.preventDefault(); event.stopPropagation(); togglePanel(); });
        updateDot();
    }

    function makePanel() {
        if (document.getElementById(PANEL_ID) || !document.body) return;
        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.style.cssText = ['display:none','position:fixed','top:75px','left:10px','right:10px','max-width:430px','max-height:75vh','margin:0 auto','overflow-y:auto','background:#171717','color:#eee','border:1px solid #555','border-radius:10px','box-shadow:0 6px 25px rgba(0,0,0,.8)','z-index:2147483646','font-family:Arial,sans-serif','box-sizing:border-box','pointer-events:auto'].join(';');
        panel.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid #444;background:#222;position:sticky;top:0;z-index:5;">
                <div><div style="font-size:18px;font-weight:bold;">RestockIQ</div><div style="font-size:11px;color:#999;">City Shop Monitor</div></div>
                <button id="restockiq-close" type="button" style="background:transparent;border:0;color:#aaa;font-size:24px;padding:4px 8px;cursor:pointer;pointer-events:auto;">×</button>
            </div>
            <div id="restockiq-key-area" style="display:none;padding:12px;border-bottom:1px solid #333;"></div>
            <div id="restockiq-watchlist-area" style="display:none;"></div>
            <div id="restockiq-status" style="padding:9px 12px;font-size:11px;color:#aaa;border-bottom:1px solid #333;">Ready</div>
            <div id="restockiq-items" style="padding:10px;"><div style="padding:15px;text-align:center;color:#777;">Waiting for city shop data...</div></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:10px;border-top:1px solid #333;position:relative;z-index:10;pointer-events:auto;">
                <button id="restockiq-refresh" type="button" style="padding:10px 5px;background:#333;color:#fff;border:1px solid #555;border-radius:6px;font-size:11px;font-weight:bold;cursor:pointer;pointer-events:auto;">REFRESH</button>
                <button id="restockiq-watchlist-button" type="button" style="padding:10px 5px;background:#333;color:#fff;border:1px solid #555;border-radius:6px;font-size:11px;font-weight:bold;cursor:pointer;pointer-events:auto;">EDIT WATCHLIST</button>
                <button id="restockiq-key-button" type="button" style="grid-column:1 / 3;padding:8px;background:#292929;color:#aaa;border:1px solid #444;border-radius:6px;font-size:10px;font-weight:bold;cursor:pointer;pointer-events:auto;">API KEY</button>
            </div>
            <div style="padding:0 12px 10px;text-align:center;color:#666;font-size:10px;">RestockIQ v${VERSION}</div>`;
        panel.addEventListener('click', handlePanelClick, true);
        document.body.appendChild(panel);
    }

    function handlePanelClick(event) {
        const target = event.target.closest('button');
        if (!target) return;
        const panel = document.getElementById(PANEL_ID);
        if (!panel || !panel.contains(target)) return;
        const id = target.id;
        if (id === 'restockiq-close') { event.preventDefault(); event.stopPropagation(); panel.style.display = 'none'; return; }
        if (id === 'restockiq-refresh') { event.preventDefault(); event.stopPropagation(); setStatus('Refreshing...'); checkStock(true); refreshMarketValues(true); return; }
        if (id === 'restockiq-watchlist-button') { event.preventDefault(); event.stopPropagation(); toggleWatchlist(); return; }
        if (id === 'restockiq-key-button') { event.preventDefault(); event.stopPropagation(); showApiSetup(); return; }
        if (id === 'restockiq-save-key') { event.preventDefault(); event.stopPropagation(); saveApiKeyFromUI(); return; }
        if (id === 'restockiq-cancel-key') { event.preventDefault(); event.stopPropagation(); const area=document.getElementById('restockiq-key-area'); if(area) area.style.display='none'; return; }
        if (id === 'restockiq-save-watchlist') { event.preventDefault(); event.stopPropagation(); saveWatchlistFromUI(); const area=document.getElementById('restockiq-watchlist-area'); if(area) area.style.display='none'; updateWatchedItemsFromShops(); renderItems(); updateDot(); setStatus('Watchlist saved.'); return; }
        if (id === 'restockiq-close-watchlist') { event.preventDefault(); event.stopPropagation(); const area=document.getElementById('restockiq-watchlist-area'); if(area) area.style.display='none'; return; }
        if (target.classList.contains('restockiq-shop-button')) { event.preventDefault(); event.stopPropagation(); const url=target.getAttribute('data-url'); if(url) window.location.href=url; }
    }

    function togglePanel() {
        makePanel(); const panel=document.getElementById(PANEL_ID); if(!panel)return;
        if(panel.style.display==='block'){panel.style.display='none';return;}
        panel.style.display='block';
        if(!getApiKey()) showApiSetup(); else {checkStock(true);refreshMarketValues(false);}
    }

    function showApiSetup() {
        const area=document.getElementById('restockiq-key-area'); if(!area)return; const hasKey=!!getApiKey(); area.style.display='block';
        area.innerHTML=`<div style="font-size:13px;font-weight:bold;margin-bottom:6px;">Torn API Key</div><div style="font-size:11px;color:#aaa;margin-bottom:8px;">${hasKey?'A Public Only key is already saved. Enter a new key only to replace it.':'Enter your Public Only Torn API key.'}</div><input id="restockiq-key-input" type="password" autocomplete="off" placeholder="${hasKey?'Key already saved':'Paste Public Only API key'}" style="width:100%;box-sizing:border-box;padding:10px;background:#0d0d0d;color:#fff;border:1px solid #555;border-radius:5px;margin-bottom:8px;pointer-events:auto;"><div style="display:flex;gap:8px;"><button id="restockiq-save-key" type="button" style="flex:1;padding:9px;background:#2f6339;color:#fff;border:0;border-radius:5px;font-weight:bold;cursor:pointer;pointer-events:auto;">SAVE KEY</button><button id="restockiq-cancel-key" type="button" style="padding:9px 14px;background:#444;color:#fff;border:0;border-radius:5px;cursor:pointer;pointer-events:auto;">CANCEL</button></div>`;
    }

    function saveApiKeyFromUI() {
        const area=document.getElementById('restockiq-key-area'),input=document.getElementById('restockiq-key-input'); if(!area||!input)return; const value=input.value.trim();
        if(!value){if(getApiKey()){area.style.display='none';setStatus('Existing API key unchanged.');}return;}
        saveApiKey(value);input.value='';area.style.display='none';setStatus('API key saved. Refreshing...');checkStock(true);refreshMarketValues(true);
    }

    function toggleWatchlist(){const area=document.getElementById('restockiq-watchlist-area');if(!area)return;if(area.style.display==='block'){area.style.display='none';return;}if(!cityShops.length){setStatus('Loading City Shops...');checkStock(true);return;}renderWatchlist();area.style.display='block';}

    function renderWatchlist(){
        const area=document.getElementById('restockiq-watchlist-area');if(!area)return;const enabledShops=getEnabledShops(),watchedItems=getWatchedItems();let html=`<div style="padding:12px;background:#111;border-bottom:1px solid #444;"><div style="font-size:16px;font-weight:bold;margin-bottom:4px;">Watchlist Manager</div><div style="font-size:10px;color:#888;margin-bottom:12px;">Select the City Shops and items RestockIQ should monitor.</div>`;
        cityShops.forEach(function(shop){if(!shop||!shop.name||!Array.isArray(shop.items))return;const shopEnabled=enabledShops.indexOf(shop.name)!==-1;html+=`<div style="margin-bottom:10px;background:#202020;border:1px solid #3d3d3d;border-radius:7px;overflow:hidden;"><label style="display:flex;align-items:center;gap:8px;padding:10px;font-size:12px;font-weight:bold;background:#292929;"><input type="checkbox" class="restockiq-shop-check" data-shop="${escapeAttribute(shop.name)}" ${shopEnabled?'checked':''}>${escapeHtml(shop.name)}<span style="margin-left:auto;color:#777;font-size:9px;font-weight:normal;">${shop.items.length} items</span></label><div class="restockiq-shop-items" data-shop-items="${escapeAttribute(shop.name)}" style="display:${shopEnabled?'block':'none'};padding:6px 10px 9px;">`;
            shop.items.forEach(function(item){if(!item||!item.name)return;const checked=watchedItems.indexOf(item.name)!==-1;html+=`<label style="display:flex;align-items:center;gap:8px;padding:7px 2px;border-bottom:1px solid #303030;font-size:11px;"><input type="checkbox" class="restockiq-item-check" data-item="${escapeAttribute(item.name)}" data-shop="${escapeAttribute(shop.name)}" ${checked?'checked':''}><span style="flex:1;">${escapeHtml(item.name)}</span><span style="color:#777;font-size:10px;">$${formatNumber(item.price)}</span></label>`;});html+='</div></div>';});
        html+=`<div style="display:flex;gap:8px;margin-top:10px;"><button id="restockiq-save-watchlist" type="button" style="flex:1;padding:10px;background:#2f6339;color:#fff;border:0;border-radius:6px;font-weight:bold;cursor:pointer;pointer-events:auto;">SAVE WATCHLIST</button><button id="restockiq-close-watchlist" type="button" style="padding:10px 14px;background:#444;color:#fff;border:0;border-radius:6px;cursor:pointer;pointer-events:auto;">CANCEL</button></div></div>`;area.innerHTML=html;
        if(!area.dataset.restockiqChangeBound){area.addEventListener('change',handleWatchlistChange);area.dataset.restockiqChangeBound='1';}
    }

    function handleWatchlistChange(event){const checkbox=event.target;if(!checkbox||!checkbox.classList||!checkbox.classList.contains('restockiq-shop-check'))return;const area=document.getElementById('restockiq-watchlist-area');if(!area)return;const shopName=checkbox.getAttribute('data-shop');area.querySelectorAll('.restockiq-shop-items').forEach(function(section){if(section.getAttribute('data-shop-items')===shopName)section.style.display=checkbox.checked?'block':'none';});}

    function saveWatchlistFromUI(){const area=document.getElementById('restockiq-watchlist-area');if(!area)return;const enabledShops=[],watchedItems=[];area.querySelectorAll('.restockiq-shop-check').forEach(function(c){if(c.checked)enabledShops.push(c.getAttribute('data-shop'));});area.querySelectorAll('.restockiq-item-check').forEach(function(c){if(!c.checked)return;const shopName=c.getAttribute('data-shop');if(enabledShops.indexOf(shopName)===-1)return;watchedItems.push(c.getAttribute('data-item'));});saveEnabledShops(enabledShops);saveWatchedItems(watchedItems);}

    function updateWatchedItemsFromShops(){const enabledShops=getEnabledShops(),watchedItems=getWatchedItems(),results=[];cityShops.forEach(function(shop){if(!shop||!shop.name||!Array.isArray(shop.items)||enabledShops.indexOf(shop.name)===-1)return;shop.items.forEach(function(item){if(!item||!item.name||watchedItems.indexOf(item.name)===-1)return;results.push({itemId:item.id,name:item.name,price:Number(item.price||0),current:item.stock?Number(item.stock.current||0):0,normal:item.stock?Number(item.stock.default||0):0,shopId:shop.id,shopName:shop.name});});});latestItems=results;}

    function refreshMarketValues(force){if(marketChecking)return;const key=getApiKey();if(!key)return;const existing=getMarketCache(),now=Date.now();if(!force&&existing.updated&&now-existing.updated<MV_REFRESH_MS){renderItems();return;}marketChecking=true;const url=ITEMS_API+'&key='+encodeURIComponent(key);fetch(url).then(function(response){if(!response.ok)throw new Error('MV HTTP '+response.status);return response.json();}).then(function(data){if(data.error)throw new Error(data.error.error||'Torn item API error');const values={};let items=[];if(Array.isArray(data.items))items=data.items;else if(data.items&&typeof data.items==='object')items=Object.keys(data.items).map(function(key){const item=data.items[key];if(item&&item.id==null)item.id=Number(key);return item;});items.forEach(function(item){if(!item||item.id==null)return;let mv=null;if(item.market_price!=null)mv=Number(item.market_price);else if(item.value&&item.value.market_price!=null)mv=Number(item.value.market_price);if(Number.isFinite(mv))values[String(item.id)]=mv;});saveMarketCache({updated:Date.now(),values:values});renderItems();}).catch(function(error){console.log('[RestockIQ MV Error]',error);renderItems();}).finally(function(){marketChecking=false;});}

    function recordStockChanges(items){const history=getHistory(),now=Date.now();items.forEach(function(item){const id=String(item.itemId);if(!history[id]){history[id]={name:item.name,shop:item.shopName,lastStock:item.current,lastCheck:now,lastRestock:null,restocks:[]};return;}const entry=history[id],previous=Number(entry.lastStock||0),current=Number(item.current||0),normal=Number(item.normal||0),increase=current-previous,substantialLevel=normal>0?current>=normal*.50:current>0,substantialJump=normal>0?increase>=normal*.40:increase>0,genuineRestock=current>previous&&((previous===0&&substantialLevel)||substantialJump);if(genuineRestock){const previousRestock=Number(entry.lastRestock||0);if(!previousRestock||now-previousRestock>60*1000){entry.lastRestock=now;if(!Array.isArray(entry.restocks))entry.restocks=[];entry.restocks.push(now);if(entry.restocks.length>20)entry.restocks=entry.restocks.slice(-20);}}entry.name=item.name;entry.shop=item.shopName;entry.lastStock=current;entry.lastCheck=now;});saveHistory(history);}

    function getRestockData(itemId){const history=getHistory(),entry=history[String(itemId)];if(!entry)return{observations:0,lastRestock:null,average:null,next:null};const restocks=Array.isArray(entry.restocks)?entry.restocks.map(Number).filter(Boolean).sort(function(a,b){return a-b;}):[],observations=restocks.length;if(observations<2)return{observations:observations,lastRestock:entry.lastRestock||null,average:null,next:null};const intervals=[];for(let i=1;i<restocks.length;i++){const difference=restocks[i]-restocks[i-1];if(difference>=60*1000&&difference<=6*60*60*1000)intervals.push(difference);}if(!intervals.length)return{observations:observations,lastRestock:entry.lastRestock||null,average:null,next:null};const recent=intervals.slice(-8),average=recent.reduce(function(sum,value){return sum+value;},0)/recent.length,lastRestock=Number(restocks[restocks.length-1]);return{observations:observations,lastRestock:lastRestock,average:average,next:lastRestock+average};}

    function getValueData(item){const mv=getMarketValue(item.itemId);if(mv==null||mv<=0)return{available:false};const city=Number(item.price||0),spread=mv-city,percent=city>0?(spread/city)*100:0;let color='#aaa',label='AT MV';if(spread>0){color='#55d878';label='BELOW MV';}else if(spread<0){color='#e05c5c';label='ABOVE MV';}return{available:true,mv:mv,city:city,spread:spread,percent:percent,color:color,label:label};}

    function renderItems(){const container=document.getElementById('restockiq-items');if(!container)return;container.innerHTML='';if(!latestItems.length){container.innerHTML='<div style="padding:18px 10px;text-align:center;color:#888;font-size:12px;">No items are currently selected.<br><br>Tap <strong>EDIT WATCHLIST</strong> to choose City Shop items.</div>';return;}latestItems.forEach(function(item){const inStock=item.current>0,statusColor=inStock?'#55d878':'#e05c5c',statusText=inStock?'IN STOCK':'SOLD OUT',percentStock=item.normal>0?Math.round((item.current/item.normal)*100):0,restock=getRestockData(item.itemId),value=getValueData(item),shopURL=SHOP_URLS[item.shopName]||null,card=document.createElement('div');card.className='restockiq-item-card';card.setAttribute('data-item-id',String(item.itemId));card.style.cssText=['background:#222','border:1px solid #3d3d3d','border-radius:7px','padding:11px','margin-bottom:8px'].join(';');let valueHTML='';if(value.available){const spreadSign=value.spread>0?'+':'',pctSign=value.percent>0?'+':'';valueHTML=`<div style="margin-top:10px;padding:8px;background:#191919;border-radius:5px;border-left:3px solid ${value.color};"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;"><span style="font-size:10px;color:#777;">MARKET VALUE</span><span style="font-size:10px;font-weight:bold;color:${value.color};">${value.label}</span></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;font-size:11px;"><div><span style="color:#777;">MV</span><br><strong>$${formatNumber(value.mv)}</strong></div><div><span style="color:#777;">Potential Spread</span><br><strong style="color:${value.color};">${spreadSign}$${formatSignedNumber(value.spread)}</strong></div><div><span style="color:#777;">Difference</span><br><strong style="color:${value.color};">${pctSign}${formatPercent(value.percent)}%</strong></div><div><span style="color:#777;">City Price</span><br><strong style="color:${value.color};">$${formatNumber(value.city)}</strong></div></div></div>`;}else valueHTML='<div style="margin-top:10px;padding:8px;background:#191919;border-radius:5px;color:#777;font-size:10px;">MV unavailable</div>';let predictionHTML='';if(!restock.average||!restock.next){predictionHTML=`<div style="margin-top:10px;padding:8px;background:#191919;border-radius:5px;"><div style="color:#d5b45b;font-size:11px;font-weight:bold;">LEARNING RESTOCK PATTERN</div><div style="margin-top:4px;color:#888;font-size:10px;">Observed Restocks: ${restock.observations}${restock.lastRestock?'<br>Last Observed: '+formatTCT(restock.lastRestock):''}</div></div>`;}else{predictionHTML=`<div style="margin-top:10px;padding:8px;background:#191919;border-radius:5px;"><div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;font-size:10px;"><div><span style="color:#777;">Last Observed</span><br><strong>${formatTCT(restock.lastRestock)}</strong></div><div><span style="color:#777;">Learned Interval</span><br><strong>${formatDuration(restock.average)}</strong></div><div><span style="color:#777;">Expected Next</span><br><strong>~${formatTCT(restock.next)}</strong></div><div><span style="color:#777;">Observations</span><br><strong>${restock.observations}</strong></div></div><div style="margin-top:8px;padding-top:8px;border-top:1px solid #333;"><span style="color:#777;font-size:10px;">NEXT RESTOCK</span><div class="restockiq-countdown" data-next="${Math.round(restock.next)}" style="margin-top:2px;font-size:16px;font-weight:bold;color:#d5b45b;">${countdownText(restock.next)}</div></div></div>`;}let shopButtonHTML='';if(shopURL)shopButtonHTML=`<button class="restockiq-shop-button" type="button" data-url="${escapeAttribute(shopURL)}" style="width:100%;margin-top:10px;padding:10px;background:${inStock?'#2f6339':'#333'};color:${inStock?'#fff':'#999'};border:1px solid ${inStock?'#477d50':'#444'};border-radius:6px;font-size:11px;font-weight:bold;cursor:pointer;pointer-events:auto;">GO TO ${escapeHtml(item.shopName.toUpperCase())}</button>`;card.innerHTML=`<div style="display:flex;justify-content:space-between;gap:10px;"><div><div style="font-size:15px;font-weight:bold;">${escapeHtml(item.name)}</div><div style="font-size:10px;color:#888;margin-top:2px;">${escapeHtml(item.shopName)}</div></div><div style="color:${statusColor};font-size:11px;font-weight:bold;white-space:nowrap;">${statusText}</div></div><div style="margin-top:9px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;font-size:11px;"><div><span style="color:#777;">Stock</span><br><strong>${formatNumber(item.current)} / ${formatNumber(item.normal)}</strong></div><div><span style="color:#777;">Full</span><br><strong>${percentStock}%</strong></div><div><span style="color:#777;">City Price</span><br><strong>$${formatNumber(item.price)}</strong></div></div>${valueHTML}${predictionHTML}${shopButtonHTML}`;container.appendChild(card);});updateCountdowns();}

    function countdownText(timestamp){if(!timestamp)return'LEARNING';const remaining=timestamp-Date.now();if(remaining<=0)return'PAST ESTIMATED RESTOCK';const totalSeconds=Math.floor(remaining/1000),hours=Math.floor(totalSeconds/3600),minutes=Math.floor((totalSeconds%3600)/60),seconds=totalSeconds%60;if(hours>0)return String(hours).padStart(2,'0')+'h '+String(minutes).padStart(2,'0')+'m '+String(seconds).padStart(2,'0')+'s';return String(minutes).padStart(2,'0')+'m '+String(seconds).padStart(2,'0')+'s';}

    function updateCountdowns(){document.querySelectorAll('.restockiq-countdown').forEach(function(element){const timestamp=Number(element.getAttribute('data-next'));if(!timestamp)return;const remaining=timestamp-Date.now();element.textContent=countdownText(timestamp);if(remaining<=0)element.style.color='#d5b45b';else if(remaining<=5*60*1000)element.style.color='#e6c85c';else element.style.color='#aaa';});}

    function updateDot(){const dot=document.getElementById('restockiq-dot');if(!dot)return;const anyInStock=latestItems.some(function(item){return item.current>0;});dot.style.display=anyInStock?'block':'none';}

    function checkStock(force){if(checking)return;if(document.visibilityState==='hidden'&&!force)return;const key=getApiKey();if(!key){setStatus('API key required.');showApiSetup();return;}checking=true;setStatus('Checking City Shops...');const url=CITYSHOPS_API+'?key='+encodeURIComponent(key);fetch(url).then(function(response){if(!response.ok)throw new Error('HTTP '+response.status);return response.json();}).then(function(data){if(data.error)throw new Error(data.error.error||'Torn API error');if(!Array.isArray(data.cityshops))throw new Error('City shop data not found.');cityShops=data.cityshops;updateWatchedItemsFromShops();recordStockChanges(latestItems);lastSuccessfulCheck=Date.now();renderItems();updateDot();const watchArea=document.getElementById('restockiq-watchlist-area');if(watchArea&&watchArea.style.display==='block')renderWatchlist();setStatus('Last checked: '+formatTCT(lastSuccessfulCheck));refreshMarketValues(false);}).catch(function(error){console.log('[RestockIQ API Error]',error);setStatus('API Error: '+error.message);}).finally(function(){checking=false;});}

    function autoCheck(){if(document.visibilityState==='hidden'||!getApiKey())return;const now=Date.now();if(lastSuccessfulCheck&&(now-lastSuccessfulCheck)<AUTO_CHECK_MS)return;checkStock(false);}

    document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible'){autoCheck();refreshMarketValues(false);}});

    function setStatus(text){const status=document.getElementById('restockiq-status');if(status)status.textContent=text;}
    function formatNumber(number){return Number(number||0).toLocaleString();}
    function formatSignedNumber(number){return Math.abs(Math.round(Number(number||0))).toLocaleString();}
    function formatPercent(number){return Math.abs(Number(number||0)).toFixed(1);}
    function formatTCT(timestamp){if(!timestamp)return'—';const date=new Date(timestamp),hours=String(date.getUTCHours()).padStart(2,'0'),minutes=String(date.getUTCMinutes()).padStart(2,'0'),seconds=String(date.getUTCSeconds()).padStart(2,'0');return hours+':'+minutes+':'+seconds+' TCT';}
    function formatDuration(milliseconds){if(!milliseconds)return'—';const totalSeconds=Math.round(milliseconds/1000),hours=Math.floor(totalSeconds/3600),minutes=Math.floor((totalSeconds%3600)/60),seconds=totalSeconds%60;if(hours>0)return hours+'h '+minutes+'m '+seconds+'s';return minutes+'m '+seconds+'s';}
    function escapeHtml(value){return String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');}
    function escapeAttribute(value){return escapeHtml(value);}

    function install(){makeButton();makePanel();}
    install();
    setTimeout(install,500);setTimeout(install,1000);setTimeout(install,2000);setTimeout(install,3000);setTimeout(install,5000);
    setInterval(function(){makeButton();makePanel();},2000);
    setInterval(autoCheck,AUTO_CHECK_MS);
    setInterval(updateCountdowns,1000);
    setTimeout(autoCheck,5000);
})();