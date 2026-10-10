import { invoke } from "@tauri-apps/api/core";

export function einkScreenContent():string {
  return '<section><h2>手动全屏刷新</h2><p>请求一次全屏刷新。屏幕可能短暂闪烁，效果取决于设备固件。</p><p>此操作不更改系统刷新模式，也不会提交答案或推进练习。</p><p id="eink-status" role="status">正在检查设备…</p><button type="button" data-action="eink-refresh" disabled>全屏刷新</button></section>';
}

export async function bindEinkScreen(root:HTMLElement):Promise<void> {
  const status=root.querySelector<HTMLElement>("#eink-status")!;
  const button=root.querySelector<HTMLButtonElement>('[data-action="eink-refresh"]')!;
  const current=()=>status.isConnected&&root.querySelector("#eink-status")===status;
  let supported=false,busy=false;
  button.addEventListener("click",async()=>{
    if(!current()||!supported||busy)return;
    busy=true;button.disabled=true;button.textContent="请求中…";status.textContent="正在发送刷新请求…";
    try {
      const result=await invoke<{requested:boolean}>("refresh_eink_screen");
      if(!result?.requested)throw Error("设备未接受刷新请求");
      if(current())status.textContent="已发送刷新请求，请观察实际屏幕。";
    } catch {
      if(current())status.textContent="刷新请求失败，可稍后重试或使用设备的系统刷新功能。";
    } finally {
      // Mirror the native cooldown; a detached screen cannot enable a new screen's button.
      await new Promise(resolve=>window.setTimeout(resolve,2000));busy=false;
      if(current()){button.disabled=false;button.textContent="全屏刷新";}
    }
  });
  try {
    const result=await invoke<{supported:boolean;message:string}>("get_eink_status");
    if(current()){supported=result?.supported===true;status.textContent=result?.message||"当前设备没有已验证的全屏刷新接口";button.disabled=!supported;}
  } catch {
    if(current())status.textContent="当前设备没有可用的全屏刷新接口，继续使用系统默认刷新。";
  }
}
