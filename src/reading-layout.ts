type Bookmark = {y:number;anchor?:string;offset?:number};

// Reading positions are transient UI state, separate from persisted answers and progress.
export class ReadingLayout {
  private positions = new Map<string,Bookmark>();
  private key: string | undefined;
  private previousY = 0;
  private routeEntry = false;
  private newItem = false;
  private generation = 0;
  private frame = 0;
  private observer: ResizeObserver | null = null;

  constructor(private root: HTMLElement) {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    const cancel = () => {this.generation++;cancelAnimationFrame(this.frame);};
    root.addEventListener("pointerdown",cancel,{passive:true});
    root.addEventListener("touchstart",cancel,{passive:true});
    root.addEventListener("keydown",cancel);
    root.addEventListener("click",cancel);
    window.addEventListener("wheel",cancel,{passive:true});
  }

  enterRoute(): void {this.routeEntry=true;}
  startNewItem(): void {this.newItem=true;}

  private readingTop(): number {
    return Math.max(window.visualViewport?.offsetTop??0,this.root.querySelector("header")?.getBoundingClientRect().bottom??0)+8;
  }

  beforeRender(): void {
    this.previousY=window.scrollY;
    if(this.key){
      const top=this.readingTop();
      const candidates=[...this.root.querySelectorAll<HTMLElement>("[data-reading-anchor]")].map((element,order)=>({element,order,rect:element.getBoundingClientRect()})).filter(({rect})=>rect.bottom>top+1);
      const crossing=candidates.filter(({rect})=>rect.top<=top+8).sort((a,b)=>b.rect.top-a.rect.top||b.order-a.order);
      const chosen=crossing[0]??candidates.sort((a,b)=>a.rect.top-b.rect.top)[0];
      this.positions.delete(this.key);
      this.positions.set(this.key,{y:this.previousY,...(chosen?{anchor:chosen.element.dataset.readingAnchor,offset:chosen.rect.top-top}:{})});
      if(this.positions.size>200)this.positions.delete(this.positions.keys().next().value!);
    }
    this.generation++;
    cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
  }

  refreshHeader(): void {
    this.observer?.disconnect();
    const header=this.root.querySelector<HTMLElement>("header");
    const measure=()=>{
      const height=header?Math.ceil(header.getBoundingClientRect().height):0;
      this.root.classList.toggle("has-fixed-header",!!header);
      this.root.style.setProperty("--header-height",`${height}px`);
      document.documentElement.style.setProperty("--header-height",`${height}px`);
    };
    measure();
    this.observer=header&&typeof ResizeObserver!=="undefined"?new ResizeObserver(measure):null;
    if(header)this.observer?.observe(header);
  }

  afterRender(key?: string): void {
    this.refreshHeader();
    const selectors:[string,string][]=[
      ["lead",".quiz>.stem"],["option",".quiz .option"],["blank",".quiz>.blank"],
      ["answer",".quiz>.answer-panel"],["answer-text",".quiz .answer-panel>.multiline"],
      ["key-points",".quiz .key-points"],["explain",".quiz .explain"],["actions",".question-actions"],
    ];
    for(const [kind,selector] of selectors)this.root.querySelectorAll<HTMLElement>(selector).forEach((element,index)=>{element.dataset.readingAnchor=`${kind}:${element.dataset.action??index}`;});
    if(this.newItem&&key)this.positions.delete(key);
    const bookmark=key?this.positions.get(key):undefined;
    const y=key||this.routeEntry||this.newItem?0:this.previousY;
    this.key=key;
    this.newItem=false;
    this.routeEntry=false;
    const expected=++this.generation;
    const restore=()=>{
      if(expected!==this.generation)return;
      const anchor=bookmark?.anchor?[...this.root.querySelectorAll<HTMLElement>("[data-reading-anchor]")].find(element=>element.dataset.readingAnchor===bookmark.anchor):undefined;
      const target=anchor?window.scrollY+anchor.getBoundingClientRect().top-this.readingTop()-(bookmark?.offset??0):bookmark?.y??y;
      window.scrollTo(0,Math.max(0,target));
    };
    restore();
    this.frame=requestAnimationFrame(restore);
    // A late font load may change formula heights; never override a subsequent user gesture.
    void document.fonts?.ready.then(()=>{if(expected===this.generation)this.frame=requestAnimationFrame(restore);});
  }
}
