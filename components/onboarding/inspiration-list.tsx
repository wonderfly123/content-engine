"use client";

import { AccountList } from "./account-list-shared";
import type { AccountInput } from "@/lib/onboarding/types";

interface InspirationListProps {
  value: AccountInput[];
  onChange: (next: AccountInput[]) => void;
}

export function InspirationList(props: InspirationListProps) {
  return <AccountList title="Inspiration accounts" {...props} />;
}
