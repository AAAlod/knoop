import type { QuestionInput } from "./types";

// These updates retain the stem, existing KaTeX nodes, inputs and reading buttons.
export function updateStudyActions(root:HTMLElement,html:string):void {
  const actions=root.querySelector<HTMLElement>(".study-actions");if(!actions)return;
  if(actions.dataset.content!==html){
    const focused=actions.contains(document.activeElement);
    actions.innerHTML=html||'<span class="reading-caption">阅读本题</span>';
    actions.dataset.content=html;
    if(focused)actions.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({preventScroll:true});
  }
  actions.style.setProperty("--study-action-count",String(actions.querySelectorAll(":scope > button").length||1));
}

export function lockStudyControl(control:HTMLButtonElement|HTMLInputElement,locked:boolean):void {
  control.toggleAttribute("data-study-locked",locked);control.disabled=locked;
}

export function updateGradedOptions(root:HTMLElement,q:QuestionInput,selected:ReadonlySet<string>,excluded:ReadonlySet<string>,submitted:boolean,locked:boolean):void {
  const answers=new Set(Array.isArray(q.answer)?q.answer:[q.answer]);
  for(const option of root.querySelectorAll<HTMLButtonElement>(".option")){
    const id=option.dataset.optionId??option.dataset.action!.slice("temp-option:".length),picked=selected.has(id),correct=answers.has(id);
    option.classList.toggle("selected",picked);option.classList.toggle("excluded",excluded.has(id));
    option.classList.toggle("right",submitted&&correct);option.classList.toggle("wrong",submitted&&picked&&!correct);
    option.setAttribute("aria-pressed",String(picked));lockStudyControl(option,locked);
    const label=!submitted?"":correct?picked?"✓ 选对":q.type==="multiple_choice"?"✓ 漏选":"✓ 正确答案":picked?"✕ 错选":"";
    let result=option.querySelector<HTMLElement>(".option-result");
    if(label){if(!result){result=document.createElement("small");result.className="option-result";option.querySelector(".option-copy")!.append(result);}if(result.textContent!==label)result.textContent=label;}
    else result?.remove();
  }
}
