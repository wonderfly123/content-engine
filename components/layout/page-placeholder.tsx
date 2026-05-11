import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface PagePlaceholderProps {
  title: string;
  description?: string;
  hint?: string;
  children?: ReactNode;
}

export function PagePlaceholder({ title, description, hint, children }: PagePlaceholderProps) {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {hint && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Not yet built</CardTitle>
            <CardDescription>{hint}</CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
      )}
      {children}
    </div>
  );
}
