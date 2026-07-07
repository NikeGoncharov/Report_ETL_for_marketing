// Скрипт для use_figma (fileKey: 2xf8eTtBoZSghUTN1Qlt4m).
// Делает ДВА дела одним MCP-вызовом (экономия лимита Starter):
//   1) достраивает фрейм «Вариант В — Студия данных» (x=3280 на странице «Лендинг · 3 варианта»);
//   2) создаёт страницу «🧩 Компоненты»: вариант-сеты с текстовыми свойствами
//      (Кнопка 8 вар., Чип канала 4, Точка-источник 5, Логотип 2, Бейдж шага 2,
//       Заголовок секции 2, Карточка возможности 2, Карточка безопасности 2, Узел схемы).
// Не выполнен 07.07.2026 — лимит MCP-вызовов Starter-плана. Идемпотентен: старые узлы удаляет.
const origPage=figma.currentPage;
const old=origPage.findChild(n=>n.name==="Вариант В — Студия данных");if(old)old.remove();
await Promise.all(["Regular","Medium","Semi Bold","Bold"].map(s=>figma.loadFontAsync({family:"Inter",style:s})));
let MONO=null;try{await figma.loadFontAsync({family:"Roboto Mono",style:"Medium"});MONO={family:"Roboto Mono",style:"Medium"}}catch(e){MONO=null}
const R={family:"Inter",style:"Regular"},M={family:"Inter",style:"Medium"},S={family:"Inter",style:"Semi Bold"},B={family:"Inter",style:"Bold"};
const MO=MONO||M;
const hx=h=>{const n=parseInt(h.slice(1),16);return{r:(n>>16&255)/255,g:(n>>8&255)/255,b:(n&255)/255}};
const sol=(h,o)=>({type:"SOLID",color:hx(h),opacity:o==null?1:o});
function box(dir,o={}){const f=figma.createFrame();f.layoutMode=dir;f.primaryAxisSizingMode="AUTO";f.counterAxisSizingMode="AUTO";f.fills=o.bg||[];if(o.gap!=null)f.itemSpacing=o.gap;if(o.p){f.paddingTop=o.p[0];f.paddingRight=o.p[1];f.paddingBottom=o.p[2];f.paddingLeft=o.p[3];}if(o.r!=null)f.cornerRadius=o.r;if(o.stroke){f.strokes=[o.stroke];f.strokeWeight=1;f.strokeAlign="INSIDE";}if(o.align)f.counterAxisAlignItems=o.align;if(o.justify)f.primaryAxisAlignItems=o.justify;f.clipsContent=false;return f}
function put(p,c,fill){p.appendChild(c);if(fill)c.layoutSizingHorizontal="FILL";return c}
function txt(s,f,size,color,o={}){const t=figma.createText();t.fontName=f;t.fontSize=size;t.characters=s;t.fills=[sol(color)];t.lineHeight={value:o.lh||140,unit:"PERCENT"};if(o.ls!=null)t.letterSpacing={value:o.ls,unit:"PERCENT"};if(o.align)t.textAlignHorizontal=o.align;if(o.name)t.name=o.name;return t}
function dot(c,d=9){const e=figma.createEllipse();e.resize(d,d);e.fills=[sol(c)];return e}
function spinner(d,c){const f=figma.createFrame();f.resize(d,d);f.fills=[];f.clipsContent=false;f.name="spin-o";const ctr=d/2,rad=d*0.40;for(let i=0;i<8;i++){const a=Math.PI*2*i/8;const rr=Math.max(1,d*(0.115-0.008*i));const e=figma.createEllipse();e.resize(rr*2,rr*2);e.x=ctr+rad*Math.cos(a)-rr;e.y=ctr+rad*Math.sin(a)-rr;e.fills=[sol(c)];f.appendChild(e)}return f}
function logo(size,c){const w=box("HORIZONTAL",{gap:2,align:"CENTER"});w.name="logo";w.appendChild(txt("Rep",B,size,c,{lh:100,ls:-3}));w.appendChild(spinner(size*0.78,c));w.appendChild(txt("rt",B,size,c,{lh:100,ls:-3}));return w}
function btn(label,kind){const b=box("HORIZONTAL",{gap:8,align:"CENTER",justify:"CENTER",r:10,p:kind.big?[13,28,13,28]:[9,16,9,16]});if(kind.bg)b.fills=[sol(kind.bg)];if(kind.stroke){b.strokes=[sol(kind.stroke,kind.so||1)];b.strokeWeight=1;}b.appendChild(txt(label,S,kind.big?15:14,kind.fg,{lh:100,name:"label"}));return b}
function section(rootF,pt,pb,name){const s=box("VERTICAL",{p:[pt,180,pb,180]});s.name=name;rootF.appendChild(s);s.layoutSizingHorizontal="FILL";s.layoutSizingVertical="HUG";return s}
function kicker(p,s){p.appendChild(txt(s.toUpperCase(),B,12,"#7aa5ff",{ls:14,lh:100}))}

// ============ ЧАСТЬ 1: ВАРИАНТ В ============
const root=box("VERTICAL");root.name="Вариант В — Студия данных";root.counterAxisSizingMode="FIXED";root.resize(1440,10);root.fills=[sol("#0b0e15")];root.x=3280;root.y=0;origPage.appendChild(root);
const top=section(root,0,0,"nav");
const nav=box("HORIZONTAL",{align:"CENTER",p:[16,0,16,0]});put(top,nav,true);nav.primaryAxisAlignItems="SPACE_BETWEEN";
nav.appendChild(logo(21,"#ffffff"));
const links=box("HORIZONTAL",{gap:20,align:"CENTER"});["Возможности","Каналы","Безопасность","FAQ"].forEach(l=>links.appendChild(txt(l,M,14,"#8b97ad",{lh:100})));nav.appendChild(links);
const auth=box("HORIZONTAL",{gap:10,align:"CENTER"});auth.appendChild(btn("Войти",{stroke:"#2b3446",fg:"#cdd6e4"}));auth.appendChild(btn("Зарегистрироваться",{bg:"#2d73ff",fg:"#ffffff"}));nav.appendChild(auth);
const tl=figma.createRectangle();tl.resize(100,1);tl.fills=[sol("#1c2331")];put(top,tl,true);
const hero=section(root,78,30,"hero");hero.counterAxisAlignItems="CENTER";
const route=box("HORIZONTAL",{gap:6,align:"CENTER",r:999,p:[7,16,7,16],stroke:sol("#232c3d")});
[["Директ","#ff6a4d"],[" + ","#8b97ad"],["Метрика","#ffba00"],[" → ","#8b97ad"],["трансформации","#8b97ad"],[" → ","#8b97ad"],["Google Sheets","#4fc482"]].forEach(([t,c])=>route.appendChild(txt(t,MO,12.5,c,{lh:100})));
hero.appendChild(route);
hero.appendChild(box("VERTICAL",{p:[26,0,0,0]}));
const h1=txt("Рекламные данные, собранные в отчёт\nбез ручной работы",B,46,"#ffffff",{align:"CENTER",lh:120,ls:-2});
h1.setRangeFills(18,35,[{type:"GRADIENT_LINEAR",gradientTransform:[[1,0,0],[0,1,0]],gradientStops:[{position:0,color:{...hx("#7aa5ff"),a:1}},{position:1,color:{...hx("#b58cff"),a:1}}]}]);
hero.appendChild(h1);
hero.appendChild(box("VERTICAL",{p:[8,0,0,0]}));
hero.appendChild(txt("Подключите кабинеты по OAuth, опишите отчёт шагами конструктора — Report сведёт источники,\nпосчитает метрики и выгрузит результат в таблицу.",R,17,"#97a3b8",{align:"CENTER",lh:160}));
hero.appendChild(box("VERTICAL",{p:[14,0,0,0]}));
const cta=box("HORIZONTAL",{gap:13,align:"CENTER"});cta.appendChild(btn("Создать аккаунт",{bg:"#2d73ff",fg:"#ffffff",big:1}));cta.appendChild(btn("Войти",{stroke:"#2b3446",fg:"#e9edf5",big:1}));hero.appendChild(cta);
hero.appendChild(box("VERTICAL",{p:[6,0,0,0]}));
hero.appendChild(txt("Некоммерческий проект · бесплатно · без карты",R,13,"#6b7890",{align:"CENTER"}));
const bwrap=box("VERTICAL",{gap:14,p:[52,0,0,0]});put(hero,bwrap,true);
function cell(title,desc){const c=box("VERTICAL",{gap:6,r:16,p:[22,22,22,22],stroke:sol("#1e2735")});c.fills=[{type:"GRADIENT_LINEAR",gradientTransform:[[0,1,0],[-1,0,1]],gradientStops:[{position:0,color:{...hx("#12161f"),a:1}},{position:1,color:{...hx("#0e121b"),a:1}}]}];c.appendChild(txt(title,S,16,"#ffffff",{lh:125}));if(desc)c.appendChild(txt(desc,R,13.5,"#8b97ad",{lh:150}));return c}
function sizeCell(c,row,w){row.appendChild(c);c.layoutSizingVertical="FILL";c.counterAxisSizingMode="FIXED";c.resize(w,c.height);c.children.forEach(ch=>{if(ch.type==="TEXT")ch.layoutSizingHorizontal="FILL"})}
const row1=box("HORIZONTAL",{gap:14});put(bwrap,row1,true);
const cFlow=cell("Пайплайн вместо копипасты","Каждый отчёт — это настроенный один раз маршрут данных.");
const mf=box("HORIZONTAL",{gap:8,align:"CENTER",p:[12,0,0,0]});mf.layoutWrap="WRAP";mf.counterAxisSpacing=8;
function mini(t,fg,bc,glow){const n=box("HORIZONTAL",{align:"CENTER",r:10,p:[8,13,8,13],bg:[sol("#131a28")],stroke:sol(bc,0.45)});if(glow)n.effects=[{type:"DROP_SHADOW",color:{...hx("#2d73ff"),a:0.2},offset:{x:0,y:0},radius:18,spread:0,visible:true,blendMode:"NORMAL"}];n.appendChild(txt(t,MO,12.5,fg,{lh:100}));return n}
mf.appendChild(mini("Директ","#ff8266","#ff6a4d"));mf.appendChild(mini("Метрика","#ffca42","#ffba00"));mf.appendChild(txt("→",R,15,"#3d4a61",{lh:100}));mf.appendChild(mini("join · group_by · filter · calc","#7aa5ff","#7aa5ff",1));mf.appendChild(txt("→",R,15,"#3d4a61",{lh:100}));mf.appendChild(mini("Sheets / CSV","#4fc482","#4fc482"));
cFlow.appendChild(mf);sizeCell(cFlow,row1,702);
const cMet=cell("Метрики, которых нет в кабинетах",null);
[["расход / лиды","CPA"],["расход / выручка","ДРР"],["(выручка − расход) / расход","ROI"]].forEach(([f,m],i)=>{const r=box("HORIZONTAL",{align:"CENTER",p:[8,0,8,0]});r.appendChild(txt(f,MO,11.5,"#6b7890",{lh:100}));const sp=box("HORIZONTAL");r.appendChild(sp);sp.layoutSizingHorizontal="FILL";r.appendChild(txt(m,MO,13,"#7aa5ff",{lh:100}));cMet.appendChild(r);r.layoutSizingHorizontal="FILL";if(i<2){const d=figma.createRectangle();d.resize(100,1);d.fills=[sol("#202a3c")];put(cMet,d,true)}});
sizeCell(cMet,row1,364);
const row2=box("HORIZONTAL",{gap:14});put(bwrap,row2,true);
sizeCell(cell("Проекты и клиенты","Отдельный проект на каждого клиента: свои интеграции, отчёты и история запусков."),row2,351);
sizeCell(cell("Превью каждого шага","Таблица пересчитывается после каждой трансформации — ошибки видны до выгрузки."),row2,351);
sizeCell(cell("UTM-разбор","Извлечение меток из ссылок и группировка по source / medium / campaign."),row2,350);
const chan=section(root,64,64,"channels");chan.itemSpacing=10;
kicker(chan,"Каналы");
chan.appendChild(txt("Источники и назначения",B,30,"#ffffff",{ls:-1.5}));
chan.appendChild(txt("Стартовый набор закрывает отчётность по Яндексу; список расширяется по запросам пользователей.",R,15,"#97a3b8"));
const crow=box("HORIZONTAL",{gap:40,p:[24,0,0,0]});put(chan,crow,true);
function chipC(label,dotHex,soon){const c=box("HORIZONTAL",{gap:8,align:"CENTER",r:999,p:[7,14,7,14],bg:soon?[]:[sol("#10141d")],stroke:sol(soon?"#2b3446":"#232c3d")});if(soon)c.dashPattern=[4,4];if(dotHex)c.appendChild(dot(dotHex));c.appendChild(txt(label,soon?M:S,13,soon?"#6b7890":"#cdd6e4",{lh:100}));return c}
function chanCol(title,items){const c=box("VERTICAL",{gap:12});c.appendChild(txt(title.toUpperCase(),B,11,"#5f6c82",{ls:12,lh:100}));const row=box("HORIZONTAL",{gap:10});row.layoutWrap="WRAP";row.counterAxisSpacing=10;items.forEach(i=>row.appendChild(i));c.appendChild(row);return c}
crow.appendChild(chanCol("Реклама",[chipC("Яндекс Директ","#FC3F1D"),chipC("ПромоСтраницы",null,1),chipC("Google Ads",null,1)]));
crow.appendChild(chanCol("Аналитика",[chipC("Яндекс Метрика","#FFBA00")]));
crow.appendChild(chanCol("Назначения",[chipC("Google Sheets","#34A853"),chipC("CSV","#6b7890")]));
const how=section(root,64,64,"how-it-works");how.itemSpacing=10;
kicker(how,"Как это работает");
how.appendChild(txt("Четыре шага",B,30,"#ffffff",{ls:-1.5}));
const srow=box("HORIZONTAL",{gap:18,p:[24,0,0,0]});put(how,srow,true);
[["01","Проект","Под клиента или направление."],["02","OAuth","Директ, Метрика, Google — в официальных окнах авторизации."],["03","Конструктор","Период → источники → шаги → превью."],["04","Выгрузка","Sheets или CSV, история запусков под рукой."]].forEach(([n,t,d])=>{const st=box("VERTICAL",{gap:8});const nb=box("VERTICAL",{align:"CENTER",justify:"CENTER",r:999,bg:[sol("#1a2233")],stroke:sol("#26324a")});nb.resize(38,38);nb.primaryAxisSizingMode="FIXED";nb.counterAxisSizingMode="FIXED";nb.appendChild(txt(n,MO,13,"#7aa5ff",{lh:100}));st.appendChild(nb);st.appendChild(txt(t,S,16,"#ffffff",{lh:120}));srow.appendChild(st);st.layoutSizingHorizontal="FILL";const dd=txt(d,R,13.5,"#8b97ad",{lh:150});put(st,dd,true)});
const sec=section(root,64,64,"security");sec.itemSpacing=10;
kicker(sec,"Безопасность данных");
sec.appendChild(txt("Прозрачные правила доступа",B,30,"#ffffff",{ls:-1.5}));
const sgrid=box("HORIZONTAL",{gap:18,p:[24,0,0,0]});sgrid.layoutWrap="WRAP";sgrid.counterAxisSpacing=18;put(sec,sgrid,true);
[["OAuth 2.0, без паролей","Авторизация в окнах Яндекса и Google; сервису достаётся только токен."],["Только чтение статистики","Кампании не управляются: ни ставок, ни остановок — только отчётные данные."],["Ноль монетизации данных","Некоммерческий проект: без рекламы, продажи и «рыночной аналитики» на ваших цифрах."],["Отзыв в один клик","Отключение в проекте или в Яндекс ID / Google-аккаунте — токен гаснет сразу."]].forEach(([t,d])=>{const strip=box("HORIZONTAL",{gap:14,r:14,p:[20,22,20,22],bg:[sol("#10141d")],stroke:sol("#1e2735")});const ic=box("VERTICAL",{align:"CENTER",justify:"CENTER",r:10,bg:[sol("#2d73ff",0.12)],stroke:sol("#7aa5ff",0.3)});ic.resize(36,36);ic.primaryAxisSizingMode="FIXED";ic.counterAxisSizingMode="FIXED";ic.appendChild(dot("#7aa5ff",10));strip.appendChild(ic);const col=box("VERTICAL",{gap:5});col.appendChild(txt(t,S,15,"#ffffff",{lh:120}));const dd=txt(d,R,13,"#8b97ad",{lh:150});col.appendChild(dd);strip.appendChild(col);sgrid.appendChild(strip);strip.layoutSizingVertical="HUG";strip.counterAxisSizingMode="FIXED";strip.resize(531,strip.height);col.layoutSizingHorizontal="FILL";dd.layoutSizingHorizontal="FILL"});
const cmp=section(root,64,64,"compare");cmp.itemSpacing=10;
kicker(cmp,"Сравнение");
cmp.appendChild(txt("Ручной процесс → пайплайн",B,30,"#ffffff",{ls:-1.5}));
const tblWrap=box("VERTICAL",{p:[14,0,0,0]});put(cmp,tblWrap,true);
const ctbl=box("VERTICAL",{r:14,stroke:sol("#1e2735")});ctbl.clipsContent=true;put(tblWrap,ctbl,true);
function rowPair(a,b,head){const r=box("HORIZONTAL",{bg:head?[sol("#131a26")]:[]});const c1=box("VERTICAL",{p:[13,16,13,16]});c1.appendChild(txt(head?a.toUpperCase():a,head?B:R,head?11.5:14,head?"#8b97ad":"#97a3b8",{ls:head?7:0}));const c2=box("VERTICAL",{p:[13,16,13,16]});c2.appendChild(txt(head?b.toUpperCase():b,head?B:M,head?11.5:14,head?"#8b97ad":"#e9edf5",{ls:head?7:0}));r.appendChild(c1);r.appendChild(c2);c1.layoutSizingHorizontal="FILL";c2.layoutSizingHorizontal="FILL";return r}
put(ctbl,rowPair("Вручную","С Report",true),true);
[["CSV из Директа + отчёт из Метрики","Данные приходят по API"],["VLOOKUP и сводные","join настраивается один раз"],["CPA и ДРР на калькуляторе","calc-поля в конструкторе"],["Каждую неделю заново","«Запустить» в готовом отчёте"]].forEach(([a,b])=>{const d=figma.createRectangle();d.resize(100,1);d.fills=[sol("#1a2230")];put(ctbl,d,true);put(ctbl,rowPair(a,b),true)});
const faq=section(root,64,64,"faq");faq.itemSpacing=10;
kicker(faq,"FAQ");
faq.appendChild(txt("Частые вопросы",B,30,"#ffffff",{ls:-1.5}));
const fl=box("VERTICAL",{p:[14,0,0,0]});put(faq,fl,true);
const FQ=[["Что сервис видит в моих аккаунтах?","Статистику кампаний Директа и отчёты Метрики по официальным API — ровно то, что нужно для ваших отчётов.","−"],["Почему бесплатно?",null,"+"],["Как отозвать доступ?",null,"+"],["Какие источники дальше?",null,"+"]];
FQ.forEach(([q,a,m],i)=>{const it=box("VERTICAL",{gap:7,p:[15,0,15,0]});put(fl,it,true);const qa=box("HORIZONTAL",{align:"CENTER"});put(it,qa,true);qa.primaryAxisAlignItems="SPACE_BETWEEN";qa.appendChild(txt(q,S,15.5,"#e9edf5",{lh:100}));qa.appendChild(txt(m,R,16,"#6b7890",{lh:100}));if(a){const at=txt(a,R,13.5,"#8b97ad",{lh:150});put(it,at,true)}if(i<FQ.length-1){const d=figma.createRectangle();d.resize(100,1);d.fills=[sol("#1c2331")];put(fl,d,true)}});
const cf=section(root,80,88,"cta-final");cf.counterAxisAlignItems="CENTER";cf.itemSpacing=12;
cf.appendChild(txt("Постройте первый пайплайн",B,30,"#ffffff",{align:"CENTER",ls:-1.5}));
const ctaSub=box("HORIZONTAL",{gap:6,align:"CENTER"});
[["Регистрация бесплатна. ","#97a3b8"],["Директ + Метрика → ваша таблица","#7aa5ff"],[" за 10 минут.","#97a3b8"]].forEach(([t,c])=>ctaSub.appendChild(txt(t,t.includes("→")?MO:R,14.5,c,{lh:100})));
cf.appendChild(ctaSub);
const cb=box("VERTICAL",{p:[14,0,0,0]});cb.appendChild(btn("Создать аккаунт",{bg:"#2d73ff",fg:"#ffffff",big:1}));cf.appendChild(cb);
const ft=section(root,24,24,"footer");
const ftl=figma.createRectangle();ftl.resize(100,1);ftl.fills=[sol("#1c2331")];ft.insertChild(0,ftl);ftl.layoutSizingHorizontal="FILL";
const fr2=box("HORIZONTAL",{align:"CENTER",p:[18,0,0,0]});put(ft,fr2,true);fr2.primaryAxisAlignItems="SPACE_BETWEEN";
fr2.appendChild(logo(15,"#cdd6e4"));
fr2.appendChild(txt("© 2026 Report — некоммерческий проект",R,13,"#6b7890",{lh:100}));
fr2.appendChild(txt("Политика конфиденциальности",R,13,"#8b97ad",{lh:100}));

// ============ ЧАСТЬ 2: СТРАНИЦА КОМПОНЕНТОВ ============
let compPage=figma.root.children.find(p=>p.name==="🧩 Компоненты");
if(compPage){[...compPage.children].forEach(c=>c.remove())}else{compPage=figma.createPage();compPage.name="🧩 Компоненты"}
function compOf(b,name){const c=figma.createComponent();c.name=name;c.layoutMode=b.layoutMode;c.primaryAxisSizingMode=b.primaryAxisSizingMode;c.counterAxisSizingMode=b.counterAxisSizingMode;c.itemSpacing=b.itemSpacing;c.paddingTop=b.paddingTop;c.paddingRight=b.paddingRight;c.paddingBottom=b.paddingBottom;c.paddingLeft=b.paddingLeft;if(typeof b.cornerRadius==="number")c.cornerRadius=b.cornerRadius;c.fills=b.fills;c.strokes=b.strokes;c.strokeWeight=b.strokeWeight;c.strokeAlign="INSIDE";c.dashPattern=b.dashPattern;c.counterAxisAlignItems=b.counterAxisAlignItems;c.primaryAxisAlignItems=b.primaryAxisAlignItems;c.clipsContent=b.clipsContent;[...b.children].forEach(ch=>c.appendChild(ch));if(b.counterAxisSizingMode==="FIXED")c.resize(b.width,c.height);b.remove();return c}
function makeSet(name,defs,x,y,darkBoard){const comps=defs.map(([props,node])=>compOf(node,props));const set=figma.combineAsVariants(comps,compPage);set.name=name;set.x=x;set.y=y;set.layoutMode="HORIZONTAL";set.layoutWrap="WRAP";set.primaryAxisSizingMode="FIXED";set.counterAxisSizingMode="AUTO";set.itemSpacing=24;set.counterAxisSpacing=24;set.paddingTop=24;set.paddingBottom=24;set.paddingLeft=24;set.paddingRight=24;set.counterAxisAlignItems="CENTER";set.resize(1000,set.height);set.fills=darkBoard?[sol("#0e1526")]:[sol("#ffffff")];set.strokes=[sol("#7b61ff")];set.strokeWeight=1;set.dashPattern=[6,6];set.cornerRadius=12;return set}
function addTextProp(set,prop,dflt,nodeName){const key=set.addComponentProperty(prop,"TEXT",dflt);set.findAll(n=>n.type==="TEXT"&&n.name===nodeName).forEach(t=>{t.componentPropertyReferences={characters:key}});return key}
function boardLabel(s,x,y){const t=txt(s.toUpperCase(),B,14,"#7b61ff",{ls:8,lh:100});t.x=x;t.y=y;compPage.appendChild(t)}
let Y=0;
boardLabel("Точка-источник (для чипов и схем)",0,Y);Y+=36;
const dotDefs=[["source=Директ","#FC3F1D"],["source=Метрика","#FFBA00"],["source=Sheets","#34A853"],["source=CSV","#7c8aa5"],["source=нейтральная","#2d73ff"]].map(([p,c])=>{const b=box("HORIZONTAL",{align:"CENTER",justify:"CENTER",p:[2,2,2,2]});b.appendChild(dot(c,10));return[p,b]});
const dotSet=makeSet("Точка-источник",dotDefs,0,Y);Y+=dotSet.height+56;
function dotInst(variant){const c=dotSet.children.find(n=>n.name==="source="+variant);return c.createInstance()}
boardLabel("Логотип",0,Y);Y+=36;
const logoSet=makeSet("Логотип",[["theme=для светлого фона",(()=>{const b=box("HORIZONTAL",{gap:2,align:"CENTER",p:[4,4,4,4]});b.appendChild(txt("Rep",B,22,"#17202e",{lh:100,ls:-3}));b.appendChild(spinner(17,"#17202e"));b.appendChild(txt("rt",B,22,"#17202e",{lh:100,ls:-3}));return b})()],["theme=для тёмного фона",(()=>{const b=box("HORIZONTAL",{gap:2,align:"CENTER",p:[4,4,4,4]});b.appendChild(txt("Rep",B,22,"#ffffff",{lh:100,ls:-3}));b.appendChild(spinner(17,"#ffffff"));b.appendChild(txt("rt",B,22,"#ffffff",{lh:100,ls:-3}));return b})()]],0,Y,true);Y+=logoSet.height+56;
boardLabel("Кнопка · style × size · свойство label",0,Y);Y+=36;
const KINDS=[["primary",{bg:"#2d73ff",fg:"#ffffff"}],["dark",{bg:"#17202e",fg:"#ffffff"}],["outline-light",{stroke:"#c9d2e0",fg:"#29344a"}],["outline-dark",{stroke:"#ffffff",so:0.3,fg:"#ffffff"}]];
const btnDefs=[];
KINDS.forEach(([k,st])=>{btnDefs.push(["style="+k+", size=md",btn("Кнопка",{...st})]);btnDefs.push(["style="+k+", size=lg",btn("Кнопка",{...st,big:1})])});
const btnSet=makeSet("Кнопка",btnDefs,0,Y,true);
addTextProp(btnSet,"label","Кнопка","label");Y+=btnSet.height+56;
boardLabel("Чип канала · theme × state · свойство label",0,Y);Y+=36;
function chipComp(theme,state){const dark=theme==="dark",soon=state==="скоро";const c=box("HORIZONTAL",{gap:8,align:"CENTER",r:999,p:[7,14,7,14]});if(dark){c.fills=soon?[]:[sol("#10141d")];c.strokes=[sol(soon?"#2b3446":"#232c3d")]}else{c.fills=soon?[]:[sol("#ffffff")];c.strokes=[sol(soon?"#c9d2e0":"#e2e7f0")]}c.strokeWeight=1;c.strokeAlign="INSIDE";if(soon)c.dashPattern=[4,4];else c.appendChild(dotInst("Директ"));c.appendChild(txt("Яндекс Директ",soon?M:S,13,dark?(soon?"#6b7890":"#cdd6e4"):(soon?"#8a96ad":"#29344a"),{lh:100,name:"label"}));return c}
const chipSet=makeSet("Чип канала",[["theme=light, state=активен",chipComp("light","активен")],["theme=light, state=скоро",chipComp("light","скоро")],["theme=dark, state=активен",chipComp("dark","активен")],["theme=dark, state=скоро",chipComp("dark","скоро")]],0,Y,true);
addTextProp(chipSet,"label","Яндекс Директ","label");Y+=chipSet.height+56;
boardLabel("Бейдж шага · свойство num",0,Y);Y+=36;
function numBadge(style){const dark=style!=="blue";const b=box("VERTICAL",{align:"CENTER",justify:"CENTER",r:999,bg:[sol(dark?"#1a2233":"#2d73ff")]});if(dark){b.strokes=[sol("#26324a")];b.strokeWeight=1}b.resize(dark?38:34,dark?38:34);b.primaryAxisSizingMode="FIXED";b.counterAxisSizingMode="FIXED";b.appendChild(txt(dark?"01":"1",dark?MO:B,dark?13:14,dark?"#7aa5ff":"#ffffff",{lh:100,name:"num"}));return b}
const nbSet=makeSet("Бейдж шага",[["style=заливка",numBadge("blue")],["style=тёмный-моно",numBadge("mono")]],0,Y,true);
addTextProp(nbSet,"num","1","num");Y+=nbSet.height+56;
boardLabel("Заголовок секции · theme · свойства kicker / title / sub",0,Y);Y+=36;
function secHeader(dark){const c=box("VERTICAL",{gap:10,p:[8,8,8,8]});c.appendChild(txt("РАЗДЕЛ",B,12,dark?"#7aa5ff":"#2d73ff",{ls:14,lh:100,name:"kicker"}));c.appendChild(txt("Заголовок секции",B,30,dark?"#ffffff":"#111827",{ls:-1.5,name:"title"}));c.appendChild(txt("Поясняющий подзаголовок секции в одну-две строки.",R,15,dark?"#97a3b8":"#4b5563",{name:"sub"}));return c}
const shSet=makeSet("Заголовок секции",[["theme=light",secHeader(false)],["theme=dark",secHeader(true)]],0,Y,true);
addTextProp(shSet,"kicker","РАЗДЕЛ","kicker");addTextProp(shSet,"title","Заголовок секции","title");addTextProp(shSet,"sub","Поясняющий подзаголовок секции в одну-две строки.","sub");Y+=shSet.height+56;
boardLabel("Карточка возможности · theme · свойства title / desc",0,Y);Y+=36;
function featCard(dark){const card=box("VERTICAL",{gap:8,r:14,p:[26,26,26,26]});if(dark){card.fills=[sol("#ffffff",0.05)];card.strokes=[sol("#ffffff",0.12)]}else{card.fills=[sol("#ffffff")];card.strokes=[sol("#e5e9f1")]}card.strokeWeight=1;card.strokeAlign="INSIDE";const t=box("VERTICAL",{r:11,align:"CENTER",justify:"CENTER"});t.resize(46,46);t.primaryAxisSizingMode="FIXED";t.counterAxisSizingMode="FIXED";t.fills=[sol("#2d73ff",0.10)];t.appendChild(dotInst("нейтральная"));card.appendChild(t);card.appendChild(txt("Название возможности",S,17,dark?"#ffffff":"#111827",{lh:120,name:"title"}));card.appendChild(txt("Короткое описание пользы в одну-две строки, без воды.",R,13.5,dark?"#a5b4cd":"#55627a",{lh:150,name:"desc"}));return card}
function fixW(c,w){c.counterAxisSizingMode="FIXED";c.resize(w,c.height);c.children.forEach(ch=>{if(ch.type==="TEXT")ch.layoutSizingHorizontal="FILL"})}
const fcSet=makeSet("Карточка возможности",[["theme=light",featCard(false)],["theme=dark",featCard(true)]],0,Y,true);
fcSet.children.forEach(c=>fixW(c,348));
addTextProp(fcSet,"title","Название возможности","title");addTextProp(fcSet,"desc","Короткое описание пользы в одну-две строки, без воды.","desc");Y+=fcSet.height+56;
boardLabel("Карточка безопасности · style · свойства title / desc",0,Y);Y+=36;
function safeLight(){const outer=box("HORIZONTAL",{r:12});outer.fills=[sol("#ffffff")];outer.strokes=[sol("#e4e9f1")];outer.strokeWeight=1;outer.strokeAlign="INSIDE";outer.clipsContent=true;const bar=figma.createRectangle();bar.resize(3,10);bar.fills=[sol("#2d73ff")];outer.appendChild(bar);bar.layoutSizingVertical="FILL";const inner=box("VERTICAL",{gap:6,p:[20,22,20,19]});outer.appendChild(inner);inner.layoutSizingHorizontal="FILL";inner.appendChild(txt("Гарантия",S,16,"#17202e",{lh:125,name:"title"}));const dd=txt("Как именно устроен доступ — архитектурно, без маркетинга.",R,13.5,"#55627a",{lh:150,name:"desc"});put(inner,dd,true);return outer}
function safeDark(){const strip=box("HORIZONTAL",{gap:14,r:14,p:[20,22,20,22],bg:[sol("#10141d")],stroke:sol("#1e2735")});const ic=box("VERTICAL",{align:"CENTER",justify:"CENTER",r:10,bg:[sol("#2d73ff",0.12)],stroke:sol("#7aa5ff",0.3)});ic.resize(36,36);ic.primaryAxisSizingMode="FIXED";ic.counterAxisSizingMode="FIXED";ic.appendChild(dot("#7aa5ff",10));strip.appendChild(ic);const col=box("VERTICAL",{gap:5});col.appendChild(txt("Гарантия",S,15,"#ffffff",{lh:120,name:"title"}));const dd=txt("Как именно устроен доступ — архитектурно, без маркетинга.",R,13,"#8b97ad",{lh:150,name:"desc"});col.appendChild(dd);strip.appendChild(col);col.layoutSizingHorizontal="FILL";dd.layoutSizingHorizontal="FILL";return strip}
const scSet=makeSet("Карточка безопасности",[["style=light-полоса",safeLight()],["style=dark-иконка",safeDark()]],0,Y,true);
scSet.children.forEach(c=>fixW(c,480));
addTextProp(scSet,"title","Гарантия","title");addTextProp(scSet,"desc","Как именно устроен доступ — архитектурно, без маркетинга.","desc");Y+=scSet.height+56;
boardLabel("Узел схемы потока · свойства title / sub",0,Y);Y+=36;
const fnBox=(()=>{const n=box("HORIZONTAL",{gap:10,align:"CENTER",r:14,p:[13,16,13,16],bg:[sol("#ffffff",0.055)],stroke:sol("#ffffff",0.13)});n.appendChild(dotInst("Директ"));const col=box("VERTICAL",{gap:2});col.appendChild(txt("Название источника",S,14,"#eef2fa",{lh:100,name:"title"}));col.appendChild(txt("что забираем · через точку",R,11.5,"#93a3bd",{lh:100,name:"sub"}));n.appendChild(col);return n})();
const fnComp=compOf(fnBox,"Узел схемы потока");compPage.appendChild(fnComp);fnComp.x=0;fnComp.y=Y;
const fnKey1=fnComp.addComponentProperty("title","TEXT","Название источника");fnComp.findAll(n=>n.type==="TEXT"&&n.name==="title").forEach(t=>t.componentPropertyReferences={characters:fnKey1});
const fnKey2=fnComp.addComponentProperty("sub","TEXT","что забираем · через точку");fnComp.findAll(n=>n.type==="TEXT"&&n.name==="sub").forEach(t=>t.componentPropertyReferences={characters:fnKey2});
return {variantC:root.id,componentsPage:compPage.name,sets:["Точка-источник","Логотип","Кнопка (8 вариантов)","Чип канала (4)","Бейдж шага (2)","Заголовок секции (2)","Карточка возможности (2)","Карточка безопасности (2)","Узел схемы потока"],mono:!!MONO};
