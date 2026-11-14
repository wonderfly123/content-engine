import type { ActionAttack, RouteAttack } from "./attacks";
import { actions } from "./attacks-actions";
import { routes as brands } from "./attacks-brands";
import { routes as content } from "./attacks-content";
import { routes as insights } from "./attacks-insights";

export const ROUTE_ATTACKS: RouteAttack[] = [...brands, ...content, ...insights];
export const ACTION_ATTACKS: ActionAttack[] = actions;
