import React from 'react';

const FIELD_CLASSES = 'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-text-muted';

type LabelWrapProps = { label?: string; children: React.ReactNode };
function LabelWrap({ label, children }: LabelWrapProps) {
  if (!label) return <>{children}</>;
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { label?: string };
export function TextInput({ label, className = '', ...props }: InputProps) {
  return (
    <LabelWrap label={label}>
      <input {...props} className={`${FIELD_CLASSES} ${className}`} />
    </LabelWrap>
  );
}

type TextAreaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string };
export function TextArea({ label, className = '', ...props }: TextAreaProps) {
  return (
    <LabelWrap label={label}>
      <textarea {...props} className={`${FIELD_CLASSES} ${className}`} />
    </LabelWrap>
  );
}

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string };
export function Select({ label, className = '', children, ...props }: SelectProps) {
  return (
    <LabelWrap label={label}>
      <select {...props} className={`${FIELD_CLASSES} ${className}`}>
        {children}
      </select>
    </LabelWrap>
  );
}
