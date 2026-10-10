type Failure = {text:string;retry?:()=>Promise<void>};

// Feedback is UI state only. Dismissing it never discards a failed write or retries an API call.
export class Feedback {
  private failures = new Map<string,Failure>();
  private success = "";
  private anchor: HTMLElement | null = null;
  private source = "notice";
  private failureNode:HTMLElement|null=null;
  private displayedFailure:Failure|undefined;
  private displayedCount=0;
  private statusNode:HTMLElement|null=null;
  private displayedSuccess="";
  constructor(private root:HTMLElement,private layout:()=>void) {}

  startAction(source:string,anchor:HTMLElement):void {
    this.source=source;this.anchor=anchor;this.success="";
    // An explicit retry of the same operation replaces its previous error.
    this.failures.delete(source);this.mount();
  }
  error(text:string,key=this.source,retry?:()=>Promise<void>):void {
    this.failures.set(key,{text,retry});this.mount();
  }
  ok(text:string):void {this.success=text;this.mount();}
  resolve(key:string):void {if(this.failures.delete(key))this.mount();}

  mount():void {
    const entry=this.failures.entries().next().value as [string,Failure]|undefined;
    const currentFailure=this.root.querySelector<HTMLElement>("#app-toast");
    const failureChanged=entry?(currentFailure!==this.failureNode||!currentFailure||this.displayedFailure!==entry[1]||this.displayedCount!==this.failures.size):!!currentFailure;
    let changed=false;
    if(failureChanged){currentFailure?.remove();changed=true;}
    if(!entry)this.root.querySelector("header.feedback-only")?.remove();
    if(entry&&failureChanged){
      const [key,failure]=entry;
      let header=this.root.querySelector<HTMLElement>("header");
      if(!header){header=document.createElement("header");header.className="feedback-only";header.setAttribute("aria-label","操作提示");this.root.prepend(header);}
      const panel=document.createElement("section");panel.id="app-toast";panel.className="feedback-panel error";
      const copy=document.createElement("p");copy.className="feedback-copy";copy.setAttribute("role","alert");
      copy.textContent=`${this.failures.size>1?`待处理提示 ${this.failures.size} 条。\n`:""}${failure.text}`;
      copy.tabIndex=0;
      const controls=document.createElement("div");controls.className="feedback-controls";
      if(failure.retry){
        const retry=this.control("重试保存",async()=>{
          if(retry.disabled)return;retry.disabled=true;retry.textContent="保存中…";retry.setAttribute("aria-busy","true");
          try{await failure.retry!();if(this.failures.get(key)===failure)this.resolve(key);}
          catch(error){this.error(`仍未保存：${error instanceof Error?error.message:String(error)}`,key,failure.retry);}
        });
        controls.append(retry);
      }
      controls.append(this.control("关闭",()=>{this.resolve(key);}));
      panel.append(copy,controls);header.append(panel);
      this.failureNode=panel;this.displayedFailure=failure;this.displayedCount=this.failures.size;
    }
    const currentStatus=this.root.querySelector<HTMLElement>("#app-status");
    const statusChanged=this.success?(currentStatus!==this.statusNode||!currentStatus||this.displayedSuccess!==this.success):!!currentStatus;
    if(statusChanged){currentStatus?.remove();changed=true;}
    if(this.success&&statusChanged){
      const panel=document.createElement("div");panel.id="app-status";panel.className="feedback-panel ok";
      const copy=document.createElement("p");copy.className="feedback-copy";copy.setAttribute("role","status");copy.textContent=this.success;
      panel.append(copy,this.control("关闭",()=>{this.success="";this.mount();},"关闭成功提示"));
      const message=this.root.querySelector("#message");
      const bar=this.root.querySelector(".bottom-actions,.form-bottom-actions,.scope-bottom");
      const local=this.anchor?.isConnected?this.anchor.closest("section,form,details"):null;
      if(bar)bar.prepend(panel);
      else if(message)message.append(panel);
      else if(local&&!local.matches(".home-study"))local.append(panel);
      else this.root.querySelector("main")?.prepend(panel);
      this.statusNode=panel;this.displayedSuccess=this.success;
    }
    if(changed)this.layout();
  }
  private control(text:string,run:()=>void|Promise<void>,label=text):HTMLButtonElement {
    const button=document.createElement("button");button.type="button";button.textContent=text;
    button.dataset.feedbackControl="";button.setAttribute("aria-label",label);
    button.addEventListener("pointerdown",event=>{if(document.activeElement?.matches("input,textarea,select"))event.preventDefault();});
    button.addEventListener("click",event=>{event.stopPropagation();if(button.isConnected&&!button.disabled)void run();});return button;
  }
}
