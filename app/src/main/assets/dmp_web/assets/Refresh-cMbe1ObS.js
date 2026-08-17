import{N as e,i as t,r as n,t as r}from"./electronApi-DLNyHQQp.js";import{D as i,E as a,Ht as o,On as s,Yt as c,_ as l,_n as u,b as d,bt as f,ct as p,et as m,g as h,mt as g,nn as _,o as v,qt as y,tr as b,un as x,v as S,vn as C,wn as w,xn as T}from"./runtime-core.esm-bundler-B4b-2GOK.js";import{R as E,Z as D,t as O,w as k}from"./VBtn-BjbSkWRu.js";import{i as A}from"./index-D5mW0G0p.js";import{t as j}from"./_plugin-vue_export-helper-BDNMzG2s.js";import{t as M}from"./tooltip-DfmynyYU.js";import{t as N}from"./VList-D1zUiYpJ.js";import{t as P}from"./VMenu-B70D8rk_.js";function F(e){return typeof e==`function`?e():s(e)}var I=typeof window<`u`&&typeof document<`u`;typeof WorkerGlobalScope<`u`&&globalThis instanceof WorkerGlobalScope;var L=()=>{};function R(e,t){function n(...n){return new Promise((r,i)=>{Promise.resolve(e(()=>t.apply(this,n),{fn:t,thisArg:this,args:n})).then(r).catch(i)})}return n}var z=e=>e();function B(e=z){let t=C(!0);function n(){t.value=!1}function r(){t.value=!0}return{isActive:u(t),pause:n,resume:r,eventFilter:(...n)=>{t.value&&e(...n)}}}function V(...e){if(e.length!==1)return w(...e);let t=e[0];return typeof t==`function`?u(_(()=>({get:t,set:L}))):C(t)}function H(e,t,n={}){let{eventFilter:r=z,...i}=n;return o(e,R(r,t),i)}function U(e,t,n={}){let{eventFilter:r,...i}=n,{eventFilter:a,pause:o,resume:s,isActive:c}=B(r);return{stop:H(e,t,{...i,eventFilter:a}),pause:o,resume:s,isActive:c}}function W(e,t,...[n]){let{flush:r=`sync`,deep:i=!1,immediate:a=!0,direction:o=`both`,transform:s={}}=n||{},c=[],l=`ltr`in s&&s.ltr||(e=>e),u=`rtl`in s&&s.rtl||(e=>e);return(o===`both`||o===`ltr`)&&c.push(U(e,e=>{c.forEach(e=>e.pause()),t.value=l(e),c.forEach(e=>e.resume())},{flush:r,deep:i,immediate:a})),(o===`both`||o===`rtl`)&&c.push(U(t,t=>{c.forEach(e=>e.pause()),e.value=u(t),c.forEach(e=>e.resume())},{flush:r,deep:i,immediate:a})),()=>{c.forEach(e=>e.stop())}}function G(e=!1,t={}){let{truthyValue:n=!0,falsyValue:r=!1}=t,i=x(e),a=C(e);function o(e){if(arguments.length)return a.value=e,a.value;{let e=F(n);return a.value=a.value===e?F(r):e,a.value}}return i?o:[a,o]}I&&window.document,I&&window.navigator,I&&window.location;function K(e,t){let n=T(u()),r=V(e),i=h({get(){let e=r.value,i=t?.getIndexOf?t.getIndexOf(n.value,e):e.indexOf(n.value);return i<0&&(i=t?.fallbackIndex??0),i},set(e){a(e)}});function a(e){let t=r.value,i=t.length,a=t[(e%i+i)%i];return n.value=a,a}function s(e=1){return a(i.value+e)}function c(e=1){return s(e)}function l(e=1){return s(-e)}function u(){return F(t?.initialValue??F(e)[0])??void 0}return o(r,()=>a(i.value)),{state:n,index:i,next:c,prev:l,go:a}}var q={__name:`ThemeSwitcher`,props:{themes:{type:Array,required:!0}},setup(i){let a=i,l=t(),{t:u}=n(),{name:d,global:f}=D(),m=D(),{state:h,next:_,index:v}=K(a.themes.map(e=>e.name),{initialValue:l.theme});p(()=>{l.theme===``?(l.theme=m.global.name.value,r.store.set(e.theme,m.global.name.value),r.window.themeChange(m.global.name.value)):(m.change(l.theme),document.documentElement.className=l.theme,r.window.themeChange(l.theme))});let y=async t=>{let n=()=>{let t=_();m.change(t),l.theme=t,r.store.set(e.theme,t),document.documentElement.className=t,r.window.themeChange(t)};if(!document.startViewTransition){n();return}await document.startViewTransition(n).ready,document.documentElement.animate({opacity:[0,1]},{duration:300,easing:`ease-in-out`,pseudoElement:`::view-transition-new(root)`}),document.documentElement.animate({opacity:[1,0]},{duration:300,easing:`ease-in-out`,pseudoElement:`::view-transition-old(root)`})};return o(()=>m.global.name.value,e=>{h.value=e}),(e,t)=>c((g(),S(O,{icon:a.themes[s(v)].icon,color:`default`,variant:`text`,onClick:y},null,8,[`icon`])),[[M,s(u)(`global.`+s(l).theme)]])}},J={__name:`NavbarThemeSwitcher`,setup(e){let t=[{name:`light`,icon:`ri-sun-line`},{name:`dark`,icon:`ri-moon-clear-line`}];return(e,n)=>{let r=q;return g(),S(r,{themes:t})}}},Y={__name:`LangSelect`,setup(c){let l=n(),{current:u}=k(),_=t(),x=h(()=>_.language),w=C([]);p(()=>{T()});let T=()=>{_.language,w.value=[{label:`简体中文`,value:`zh`},{label:`English`,value:`en`}]};o(()=>_.language,()=>{T()},{deep:!0});let E=t=>{switch(l.locale.value=t,_.language=t,r.store.set(e.language,t),t){case`zh`:u.value=`zhHans`;break;case`en`:u.value=`en`;break;default:u.value=`zhHans`}};return(e,t)=>(g(),S(P,{"open-on-hover":``},{activator:y(({props:e})=>[i(O,m({color:`default`,icon:`ri-translate-2`,variant:`text`},e),null,16)]),default:y(()=>[i(N,null,{default:y(()=>[(g(!0),d(v,null,f(s(w),e=>(g(),S(A,{key:e.value,command:e.value,disabled:s(x)===e.value,onClick:t=>E(e.value)},{default:y(()=>[a(b(e.label),1)]),_:2},1032,[`command`,`disabled`,`onClick`]))),128))]),_:1})]),_:1}))}},X={__name:`Github`,setup(e){let{t}=n(),i=()=>{r.browser.open(`https://github.com/miracleEverywhere/dst-management-platform-desktop`)};return(e,n)=>c((g(),S(O,{icon:`ri-github-line`,color:`default`,variant:`text`,rel:`noopener noreferrer`,onClick:i},null,512)),[[M,s(t)(`global.github`)]])}},Z={__name:`Document`,setup(e){let{t}=n(),i=()=>{r.browser.open(`https://miraclesses.top/`)};return(e,n)=>c((g(),S(O,{icon:`ri-book-marked-line`,color:`default`,variant:`text`,rel:`noopener noreferrer`,onClick:i},null,512)),[[M,s(t)(`global.document`)]])}},Q=(e=`#8C57FF`)=>{let t=`
  <svg class="svg-canvas" viewBox="100 100 600 400" width="800" height="600" preserveAspectRatio="none" version="1.1"
     xmlns="http://www.w3.org/2000/svg">
  <g id="shape_Y1MFRqHJ6u" mask="">
    <g transform="translate(120,135.97354382365) rotate(0,280,164.02645617635) scale(1,1)"
       style="opacity: 1;mix-blend-mode: undefined;" filter="">
      <svg data-noselect="" viewBox="222.29009226667768 82.52330644317703 383.19672 224.48000000000002" width="560"
           height="328.05291235269" preserveAspectRatio="none" version="1.1" xmlns="http://www.w3.org/2000/svg"
           style="background: transparent;" class="style-removed" data-parent="shape_Y1MFRqHJ6u">
        <g id="shape_GhDKMseSsz" class="icon custom-icon text brand_word_letter" mask="">
          <g transform="translate(-195.58618432116998,-562.944415548383) rotate(0,703.44772199156,756.94772199156) scale(1,1)"
             style="" filter="" cursor="move" display="inline" opacity="1">
            <g style="" display="inline">
              <svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="1406.89544398312" height="1513.89544398312"
                   viewBox="0 0 1406.89544398312 1513.89544398312" data-ligature="true" preserveAspectRatio="none"
                   data-parent="shape_GhDKMseSsz">
                <g transform="translate(631.2029965878477, 630.94772199156)">
                  <path
                    d="M55.73 0L18.09 0L18.09-156.48L72.98-156.48Q90.23-156.48 104.53-151.85Q118.83-147.22 127.35-136.08Q135.87-124.93 135.87-105.58L135.87-105.58Q135.87-87.07 127.24-75.19Q118.62-63.31 104.63-57.63Q90.65-51.95 74.03-51.95L74.03-51.95L55.73-51.95L55.73 0ZM55.73-126.82L55.73-81.60L72.14-81.60Q85.81-81.60 92.54-87.81Q99.27-94.01 99.27-105.58L99.27-105.58Q99.27-117.36 92.02-122.09Q84.76-126.82 71.09-126.82L71.09-126.82L55.73-126.82Z"
                    transform="translate(0 205) " fill="${e}" stroke="${e}" stroke-width="33.351"
                    stroke-miterlimit="3"></path>
                </g>
                <g transform="translate(631.2029965878477, 630.94772199156)">
                  <path
                    d="M55.73 0L18.09 0L18.09-156.48L72.98-156.48Q90.23-156.48 104.53-151.85Q118.83-147.22 127.35-136.08Q135.87-124.93 135.87-105.58L135.87-105.58Q135.87-87.07 127.24-75.19Q118.62-63.31 104.63-57.63Q90.65-51.95 74.03-51.95L74.03-51.95L55.73-51.95L55.73 0ZM55.73-126.82L55.73-81.60L72.14-81.60Q85.81-81.60 92.54-87.81Q99.27-94.01 99.27-105.58L99.27-105.58Q99.27-117.36 92.02-122.09Q84.76-126.82 71.09-126.82L71.09-126.82L55.73-126.82Z"
                    transform="translate(0 205) " fill="#ffffff" stroke="#ffffff" stroke-width="0.351"></path>
                </g>
              </svg>
            </g>
          </g>
        </g>
        <g id="shape_m5SrZGu7uo" class="icon custom-icon text brand_word_letter"
           mask="">
          <g transform="translate(-312.08618432117,-562.944415548383) rotate(0,723.44772199156,756.94772199156) scale(1,1)"
             style="" filter="" cursor="move" display="inline" opacity="1">
            <g style="" display="inline">
              <svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="1446.89544398312" height="1513.89544398312"
                   viewBox="0 0 1446.89544398312 1513.89544398312" data-ligature="true" preserveAspectRatio="none"
                   data-parent="shape_m5SrZGu7uo">
                <g transform="translate(631.2225965878476, 630.94772199156)">
                  <path
                    d="M51.74 0L18.09 0L18.09-156.48L58.68-156.48L83.50-88.97Q86.44-80.13 89.18-70.67L89.18-70.67Q90.65-65.62 92.12-60.36L92.12-60.36L93.17-60.36Q95.49-67.72 97.59-75.29L97.59-75.29Q99.69-82.24 101.79-88.97L101.79-88.97L125.77-156.48L166.57-156.48L166.57 0L132.29 0L132.29-53.63Q132.29-64.99 133.87-79.71Q135.45-94.43 136.92-106.42L136.92-106.42Q137.13-107.26 137.13-107.89L137.13-107.89L136.29-107.89L123.25-70.46L102.22-13.25L81.60-13.25L60.36-70.46L47.74-107.89L46.90-107.89Q46.90-107.26 47.11-106.42L47.11-106.42Q48.58-94.43 50.16-79.71Q51.74-64.99 51.74-53.63L51.74-53.63L51.74 0Z"
                    transform="translate(0 205) " fill="${e}" stroke="${e}" stroke-width="33.351"
                    stroke-miterlimit="3"></path>
                </g>
                <g transform="translate(631.2225965878476, 630.94772199156)">
                  <path
                    d="M51.74 0L18.09 0L18.09-156.48L58.68-156.48L83.50-88.97Q86.44-80.13 89.18-70.67L89.18-70.67Q90.65-65.62 92.12-60.36L92.12-60.36L93.17-60.36Q95.49-67.72 97.59-75.29L97.59-75.29Q99.69-82.24 101.79-88.97L101.79-88.97L125.77-156.48L166.57-156.48L166.57 0L132.29 0L132.29-53.63Q132.29-64.99 133.87-79.71Q135.45-94.43 136.92-106.42L136.92-106.42Q137.13-107.26 137.13-107.89L137.13-107.89L136.29-107.89L123.25-70.46L102.22-13.25L81.60-13.25L60.36-70.46L47.74-107.89L46.90-107.89Q46.90-107.26 47.11-106.42L47.11-106.42Q48.58-94.43 50.16-79.71Q51.74-64.99 51.74-53.63L51.74-53.63L51.74 0Z"
                    transform="translate(0 205) " fill="#ffffff" stroke="#ffffff" stroke-width="0.351"></path>
                </g>
              </svg>
            </g>
          </g>
        </g>
        <g id="shape_MBN9cAwyOG" class="icon custom-icon text brand_word_letter"
           mask="">
          <g transform="translate(-393.08618432117,-562.944415548383) rotate(0,707.94772199156,756.94772199156) scale(1,1)"
             style="" filter="" cursor="move" display="inline" opacity="1">
            <g style="" display="inline">
              <svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="1415.89544398312" height="1513.89544398312"
                   viewBox="0 0 1415.89544398312 1513.89544398312" data-ligature="true" preserveAspectRatio="none"
                   data-parent="shape_MBN9cAwyOG">
                <g transform="translate(631.2862765878476, 630.94772199156)">
                  <path
                    d="M65.20 0L18.09 0L18.09-156.48L63.10-156.48Q87.07-156.48 104.84-148.49Q122.62-140.49 132.50-123.46Q142.39-106.42 142.39-79.08L142.39-79.08Q142.39-51.95 132.61-34.39Q122.83-16.83 105.48-8.41Q88.12 0 65.20 0L65.20 0ZM55.73-126.61L55.73-30.29L60.78-30.29Q73.40-30.29 83.18-34.70Q92.96-39.12 98.43-49.85Q103.90-60.57 103.90-79.08L103.90-79.08Q103.90-97.80 98.43-108.10Q92.96-118.41 83.18-122.51Q73.40-126.61 60.78-126.61L60.78-126.61L55.73-126.61Z"
                    transform="translate(0 205) " fill="${e}" stroke="${e}" stroke-width="33.351"
                    stroke-miterlimit="3"></path>
                </g>
                <g transform="translate(631.2862765878476, 630.94772199156)">
                  <path
                    d="M65.20 0L18.09 0L18.09-156.48L63.10-156.48Q87.07-156.48 104.84-148.49Q122.62-140.49 132.50-123.46Q142.39-106.42 142.39-79.08L142.39-79.08Q142.39-51.95 132.61-34.39Q122.83-16.83 105.48-8.41Q88.12 0 65.20 0L65.20 0ZM55.73-126.61L55.73-30.29L60.78-30.29Q73.40-30.29 83.18-34.70Q92.96-39.12 98.43-49.85Q103.90-60.57 103.90-79.08L103.90-79.08Q103.90-97.80 98.43-108.10Q92.96-118.41 83.18-122.51Q73.40-126.61 60.78-126.61L60.78-126.61L55.73-126.61Z"
                    transform="translate(0 205) " fill="#ffffff" stroke="#ffffff" stroke-width="0.351"></path>
                </g>
              </svg>
            </g>
          </g>
        </g>
      </svg>
    </g>
  </g>
</svg>
`;return`data:image/svg+xml;charset=UTF-8,${encodeURIComponent(t)}`},$={class:`font-weight-medium leading-normal text-xl text-uppercase`},ee=j({__name:`NavHeader`,setup(e){let t=Q();return(e,n)=>(g(),d(v,null,[i(E,{width:`3em`,height:`2em`,src:s(t)},null,8,[`src`]),l(`h1`,$,b(e.$t(`global.title`)),1)],64))}},[[`__scopeId`,`data-v-bfb49ee7`]]),te={__name:`Refresh`,setup(e){let{t}=n();return(e,n)=>c((g(),S(O,{icon:`ri-refresh-line`,color:`default`,variant:`text`,onClick:n[0]||=e=>s(r).window.reload()},null,512)),[[M,s(t)(`global.refresh`)]])}};export{Y as a,G as c,X as i,ee as n,J as o,Z as r,W as s,te as t};