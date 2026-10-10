export function screenReadingBar(actions: string): string {
  return `<div class="bottom-actions reading-bottom"><button type="button" class="reading-page" data-reading-direction="-1" aria-label="阅读上屏">上屏</button><div class="study-actions">${actions||'<span class="reading-caption">阅读本题</span>'}</div><button type="button" class="reading-page" data-reading-direction="1" aria-label="阅读下屏">下屏</button></div>`;
}

export function bindScreenReading(root: HTMLElement): () => void {
  const bar=root.querySelector<HTMLElement>(".reading-bottom");
  if(!bar)return ()=>{};
  const up=bar.querySelector<HTMLButtonElement>('[data-reading-direction="-1"]')!;
  const down=bar.querySelector<HTMLButtonElement>('[data-reading-direction="1"]')!;
  const actions=bar.querySelector<HTMLElement>(".study-actions")!;
  actions.style.setProperty("--study-action-count",String(actions.querySelectorAll(":scope > button").length||1));
  const viewport=window.visualViewport;
  let frame=0;
  const bounds=()=>{
    const top=Math.max(viewport?.offsetTop??0,root.querySelector("header")?.getBoundingClientRect().bottom??0)+8;
    const bottom=Math.min(window.innerHeight,(viewport?.offsetTop??0)+(viewport?.height??window.innerHeight),bar.getBoundingClientRect().top)-8;
    const height=Math.max(0,bottom-top);
    const lead=root.querySelector<HTMLElement>(".stem");
    const line=lead?parseFloat(getComputedStyle(lead).lineHeight):24;
    const overlap=Math.min(height/3,Math.max(32,(Number.isFinite(line)?line:24)*2));
    const max=Math.max(0,(document.scrollingElement?.scrollHeight??document.documentElement.scrollHeight)-window.innerHeight);
    return {height,step:Math.max(1,Math.floor(height-overlap)),max};
  };
  const update=()=>{
    if(!bar.isConnected)return;
    const {height,max}=bounds(),atTop=window.scrollY<=1,atBottom=window.scrollY>=max-1;
    up.disabled=height<1||atTop;down.disabled=height<1||atBottom;
    up.textContent=atTop?"页首":"上屏";down.textContent=atBottom?"页末":"下屏";
    up.setAttribute("aria-label",atTop?"上屏，已到页首":"阅读上屏");
    down.setAttribute("aria-label",atBottom?"下屏，已到页末":"阅读下屏");
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;update();});};
  const move=(direction:number)=>{
    if(!bar.isConnected||root.querySelector(".reading-bottom")!==bar)return;
    const {height,step,max}=bounds();if(height<1)return;
    // Only the viewport moves. Do not rebuild the question, submit or flush answer drafts.
    window.scrollTo(0,Math.max(0,Math.min(max,window.scrollY+direction*step)));
    update();
  };
  const keepInput=(event:PointerEvent)=>{
    if(document.activeElement?.matches("input,textarea,select"))event.preventDefault();
  };
  const previous=()=>move(-1),next=()=>move(1);
  up.addEventListener("click",previous);down.addEventListener("click",next);
  up.addEventListener("pointerdown",keepInput);down.addEventListener("pointerdown",keepInput);
  window.addEventListener("scroll",schedule,{passive:true});
  window.addEventListener("resize",schedule);
  viewport?.addEventListener("resize",schedule);viewport?.addEventListener("scroll",schedule);
  const observer=typeof ResizeObserver==="undefined"?null:new ResizeObserver(schedule);
  observer?.observe(root);observer?.observe(bar);
  const header=root.querySelector("header");if(header)observer?.observe(header);
  update();schedule();
  return ()=>{
    cancelAnimationFrame(frame);observer?.disconnect();
    up.removeEventListener("click",previous);down.removeEventListener("click",next);
    up.removeEventListener("pointerdown",keepInput);down.removeEventListener("pointerdown",keepInput);
    window.removeEventListener("scroll",schedule);window.removeEventListener("resize",schedule);
    viewport?.removeEventListener("resize",schedule);viewport?.removeEventListener("scroll",schedule);
  };
}
