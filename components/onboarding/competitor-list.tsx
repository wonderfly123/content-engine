"use client";

import { AccountList } from "./account-list-shared";
import type { AccountInput } from "@/lib/onboarding/types";

interface CompetitorListProps {
  value: AccountInput[];
  onChange: (next: AccountInput[]) => void;
}

export function CompetitorList(props: CompetitorListProps) {
  return <AccountList title="Competitors" {...props} />;
}
