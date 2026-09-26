interface ValidationIssue { instancePath?: string; message?: string }
declare const validate: ((data: unknown) => boolean) & { errors?: ValidationIssue[] | null };
export default validate;
