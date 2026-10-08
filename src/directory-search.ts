import {parseQuestion,type QuestionInput,type QuestionRow} from "./types";
export interface DirectoryEntry {row:QuestionRow;index:number;question:QuestionInput;text:string}
export function searchText(q:QuestionInput):string{
  return [q.stem,q.front,q.back,q.prompt,q.content,q.explanation,Array.isArray(q.answer)?q.answer.join(" "):q.answer,...(q.options??[]).map(o=>`${o.id} ${o.text}`),...(q.tags??[]),...(q.keyPoints??[])].filter(Boolean).join("\n").toLocaleLowerCase();
}
export function indexDirectory(rows:QuestionRow[]):DirectoryEntry[]{return rows.map((row,index)=>{const question=parseQuestion(row);return {row,index,question,text:searchText(question)};});}
export function searchDirectory(index:DirectoryEntry[],query:string):DirectoryEntry[]{const terms=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);return index.filter(entry=>terms.every(term=>entry.text.includes(term)));}
