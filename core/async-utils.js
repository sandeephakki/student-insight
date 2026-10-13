// Shared non-business helpers (timing + scroll). Zero imports on purpose so
// UI, BAL and core can all use them without creating layer violations or cycles.
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

function scrollToEl(el){
  if(!el)return;
  const headerH=(parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--content-top"))||96)+14;
  const rect=el.getBoundingClientRect();
  // Already fully visible below the fixed header and above the viewport
  // bottom? Don't move the page at all.
  if(rect.top>=headerH&&rect.bottom<=window.innerHeight)return;
  const targetY=window.scrollY+rect.top-headerH;
  window.scrollTo({top:Math.max(0,targetY),behavior:"smooth"});
}

export { sleep, scrollToEl };
if(typeof window!=='undefined'){window.sleep=sleep;window.scrollToEl=scrollToEl;}
