/* P2 #10: native-DOM replacement for jQuery 3.7.1 (~30KB over CDN).
   Implements only the API surface this codebase actually calls (audited via
   grep across every .js file: html, text, val, attr, removeAttr, prop, css,
   addClass/removeClass/toggleClass/hasClass, show/hide/toggle, is, find,
   closest, append, remove, empty, next, children, on, each, get, eq, first,
   fadeOut, length, plus $(document)/$(window)/$(htmlString)/$(el)). This is
   NOT a general jQuery replacement — do not assume any method not listed
   here (or in PIB) works; check this file before using a new $-method.
   Loaded as a plain global script (not a module) so every other script tag,
   which all still reference bare `$`, keeps working unchanged. */
(function(){
"use strict";

function toCamel(s){return s.replace(/-([a-z])/g,function(_,c){return c.toUpperCase();});}

function Q(els){
  this.els=els;
  this.length=els.length;
  for(var i=0;i<els.length;i++)this[i]=els[i];
}
Q.prototype.get=function(i){return i==null?this.els.slice():this.els[i];};
Q.prototype.eq=function(i){var e=this.els[i];return new Q(e?[e]:[]);};
Q.prototype.first=function(){return this.eq(0);};
Q.prototype.each=function(fn){for(var i=0;i<this.els.length;i++)fn.call(this.els[i],i,this.els[i]);return this;};
Q.prototype.map=function(fn){var out=[];for(var i=0;i<this.els.length;i++)out.push(fn.call(this.els[i],i,this.els[i]));return new Q(out);};
Q.prototype.filter=function(fn){var out=[];for(var i=0;i<this.els.length;i++)if(fn.call(this.els[i],i,this.els[i]))out.push(this.els[i]);return new Q(out);};
Q.prototype.add=function(other){
  var extra=other instanceof Q?other.els:(typeof other==="string"?Array.prototype.slice.call(document.querySelectorAll(other)):[other]);
  var merged=this.els.slice();
  for(var i=0;i<extra.length;i++)if(merged.indexOf(extra[i])===-1)merged.push(extra[i]);
  return new Q(merged);
};

Q.prototype.html=function(v){
  if(v===undefined)return this.els[0]?this.els[0].innerHTML:undefined;
  for(var i=0;i<this.els.length;i++)this.els[i].innerHTML=v;
  return this;
};
Q.prototype.text=function(v){
  if(v===undefined)return this.els[0]?this.els[0].textContent:undefined;
  for(var i=0;i<this.els.length;i++)this.els[i].textContent=v;
  return this;
};
Q.prototype.val=function(v){
  if(v===undefined)return this.els[0]?this.els[0].value:undefined;
  for(var i=0;i<this.els.length;i++)this.els[i].value=v;
  return this;
};
Q.prototype.attr=function(name,v){
  if(name&&typeof name==="object"){
    for(var i=0;i<this.els.length;i++)for(var k in name)this.els[i].setAttribute(k,name[k]);
    return this;
  }
  if(v===undefined)return this.els[0]?this.els[0].getAttribute(name):undefined;
  for(var j=0;j<this.els.length;j++)this.els[j].setAttribute(name,v);
  return this;
};
Q.prototype.removeAttr=function(name){for(var i=0;i<this.els.length;i++)this.els[i].removeAttribute(name);return this;};
Q.prototype.prop=function(name,v){
  if(v===undefined)return this.els[0]?this.els[0][name]:undefined;
  for(var i=0;i<this.els.length;i++)this.els[i][name]=v;
  return this;
};
Q.prototype.css=function(name,v){
  if(name&&typeof name==="object"){
    for(var i=0;i<this.els.length;i++)for(var k in name)this.els[i].style[toCamel(k)]=name[k];
    return this;
  }
  if(v===undefined)return this.els[0]?getComputedStyle(this.els[0])[toCamel(name)]:undefined;
  for(var j=0;j<this.els.length;j++)this.els[j].style[toCamel(name)]=v;
  return this;
};
Q.prototype.addClass=function(c){
  var list=String(c).split(/\s+/).filter(Boolean);
  for(var i=0;i<this.els.length;i++){var cl=this.els[i].classList;for(var k=0;k<list.length;k++)cl.add(list[k]);}
  return this;
};
Q.prototype.removeClass=function(c){
  var list=String(c).split(/\s+/).filter(Boolean);
  for(var i=0;i<this.els.length;i++){var cl=this.els[i].classList;for(var k=0;k<list.length;k++)cl.remove(list[k]);}
  return this;
};
Q.prototype.toggleClass=function(c,force){for(var i=0;i<this.els.length;i++)this.els[i].classList.toggle(c,force);return this;};
Q.prototype.hasClass=function(c){for(var i=0;i<this.els.length;i++)if(this.els[i].classList.contains(c))return true;return false;};
Q.prototype.show=function(){
  for(var i=0;i<this.els.length;i++){
    var e=this.els[i];
    e.style.removeProperty("display");
    if(getComputedStyle(e).display==="none")e.style.display="block";
  }
  return this;
};
Q.prototype.hide=function(){for(var i=0;i<this.els.length;i++)this.els[i].style.display="none";return this;};
Q.prototype.toggle=function(force){
  for(var i=0;i<this.els.length;i++){
    var e=this.els[i],hidden=getComputedStyle(e).display==="none";
    var doShow=force!==undefined?force:hidden;
    if(doShow){e.style.removeProperty("display");if(getComputedStyle(e).display==="none")e.style.display="block";}
    else e.style.display="none";
  }
  return this;
};
Q.prototype.is=function(sel){
  for(var i=0;i<this.els.length;i++){
    var e=this.els[i];
    // BUG FIX (country/language dropdown false "Run analysis first" toast):
    // this used to check only the element's OWN display property, ignoring
    // ancestors. #legacy-dashboard-body/#bucket-answer-screen have no
    // display:none of their own — only their ancestor #panel-dashboard does
    // while another step (e.g. Home) is active — so this reported them
    // "visible" even when genuinely hidden offscreen. reapplyI18nStrings()
    // (render-i18n.js) trusted that to decide whether to re-render the
    // dashboard bucket on a language switch, calling openBucket() ->
    // goStep("dashboard") from Home, tripping the empty-data guard toast.
    // Real jQuery's :visible checks rendered geometry instead (accounts for
    // any hidden ancestor, not just the element itself) — matched here.
    if(sel===":visible"){if(e.offsetWidth||e.offsetHeight||e.getClientRects().length)return true;continue;}
    if(sel===":hidden"){if(!(e.offsetWidth||e.offsetHeight||e.getClientRects().length))return true;continue;}
    if(e.matches&&e.matches(sel))return true;
  }
  return false;
};
Q.prototype.find=function(sel){
  var out=[],trimmed=sel.trim(),scoped=trimmed[0]===">"?":scope "+trimmed:sel;
  for(var i=0;i<this.els.length;i++){
    var found=this.els[i].querySelectorAll(scoped);
    for(var j=0;j<found.length;j++)out.push(found[j]);
  }
  return new Q(out);
};
Q.prototype.closest=function(sel){
  var out=[];
  for(var i=0;i<this.els.length;i++){
    var c=this.els[i].closest(sel);
    if(c&&out.indexOf(c)===-1)out.push(c);
  }
  return new Q(out);
};
Q.prototype.append=function(content){
  for(var i=0;i<this.els.length;i++){
    var e=this.els[i];
    if(content instanceof Q){for(var j=0;j<content.els.length;j++)e.appendChild(j===0||content.els.length===1?content.els[j]:content.els[j].cloneNode(true));}
    else if(typeof Node!=="undefined"&&content instanceof Node)e.appendChild(content);
    else e.insertAdjacentHTML("beforeend",String(content));
  }
  return this;
};
Q.prototype.remove=function(){for(var i=0;i<this.els.length;i++)if(this.els[i].remove)this.els[i].remove();return this;};
Q.prototype.empty=function(){for(var i=0;i<this.els.length;i++)this.els[i].innerHTML="";return this;};
Q.prototype.next=function(sel){
  var out=[];
  for(var i=0;i<this.els.length;i++){
    var n=this.els[i].nextElementSibling;
    if(n&&(!sel||n.matches(sel)))out.push(n);
  }
  return new Q(out);
};
Q.prototype.children=function(sel){
  var out=[];
  for(var i=0;i<this.els.length;i++){
    var kids=this.els[i].children;
    for(var j=0;j<kids.length;j++)if(!sel||kids[j].matches(sel))out.push(kids[j]);
  }
  return new Q(out);
};
Q.prototype.on=function(event,selOrHandler,maybeHandler){
  var events=event.split(/\s+/);
  var delegated=typeof selOrHandler==="string";
  var sel=delegated?selOrHandler:null;
  var handler=delegated?maybeHandler:selOrHandler;
  for(var e=0;e<events.length;e++){
    (function(ev){
      for(var i=0;i<this.els.length;i++){
        (function(root){
          root.addEventListener(ev,function(domEvent){
            if(!delegated){handler.call(root,domEvent);return;}
            var t=domEvent.target;
            while(t&&t!==root){
              if(t.matches&&t.matches(sel)){handler.call(t,domEvent);return;}
              t=t.parentElement;
            }
          });
        })(this.els[i]);
      }
    }).call(this,events[e]);
  }
  return this;
};
Q.prototype.fadeOut=function(duration,cb){
  var raf=(typeof requestAnimationFrame==="function")?requestAnimationFrame:function(fn){setTimeout(fn,0);};
  for(var i=0;i<this.els.length;i++){
    (function(e){
      e.style.transition="opacity "+duration+"ms";
      e.style.opacity=getComputedStyle(e).opacity||"1";
      raf(function(){e.style.opacity="0";});
      setTimeout(function(){e.style.display="none";if(cb)cb.call(e);},duration);
    })(this.els[i]);
  }
  return this;
};

function $(sel){
  if(sel instanceof Q)return sel;
  if(typeof sel==="function"){
    // Real jQuery always defers ready callbacks to a macrotask (even when
    // the document is already complete, via a `setTimeout(fn)` — see
    // jQuery.ready.promise() in jquery src) rather than ever calling fn
    // synchronously inline with the <script> tag that registered it. That
    // matters here: callers rely on their own module's top-level bindings
    // (e.g. imported `APP`) being fully initialized by the time this fires,
    // which a synchronous call could violate if the module registers its
    // $(fn) before another module's export finishes evaluating.
    if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",sel);
    else setTimeout(sel,0);
    return undefined;
  }
  if(typeof sel==="string"){
    var trimmed=sel.trim();
    if(trimmed[0]==="<"){
      var tpl=document.createElement("template");
      tpl.innerHTML=trimmed;
      var nodes=[];
      for(var i=0;i<tpl.content.childNodes.length;i++){
        var n=tpl.content.childNodes[i];
        if(n.nodeType===1)nodes.push(n);
      }
      return new Q(nodes);
    }
    return new Q(Array.prototype.slice.call(document.querySelectorAll(sel)));
  }
  if(sel===document||sel===window)return new Q([sel]);
  if(typeof Node!=="undefined"&&sel instanceof Node)return new Q([sel]);
  if(typeof NodeList!=="undefined"&&sel instanceof NodeList||Array.isArray(sel))return new Q(Array.prototype.slice.call(sel));
  if(sel==null)return new Q([]);
  return new Q([sel]);
}
window.$=$;
window.jQuery=$;
})();
