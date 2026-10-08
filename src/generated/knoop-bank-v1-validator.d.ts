interface ValidationIssue { instancePath: string; message?: string; keyword: string; params: Record<string, string> }
declare const validate: ((data: unknown) => boolean) & { errors?: ValidationIssue[] | null };
export default validate;
