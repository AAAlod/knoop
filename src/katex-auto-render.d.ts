declare module "katex/contrib/auto-render" {
  export interface AutoRenderDelimiter {
    left: string;
    right: string;
    display: boolean;
  }
  export interface AutoRenderOptions {
    delimiters?: AutoRenderDelimiter[];
    ignoredTags?: string[];
    ignoredClasses?: string[];
    throwOnError?: boolean;
    strict?: boolean | "ignore" | "warn" | "error";
    trust?: boolean;
  }
  export default function renderMathInElement(element: HTMLElement, options?: AutoRenderOptions): void;
}
