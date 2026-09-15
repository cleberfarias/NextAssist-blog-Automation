import type { SkillDefinition } from "../types.js";
import { decideRevenueAction } from "../../revenue/director.js";
import type { RevenueDecision, RevenueSnapshot } from "../../revenue/types.js";

export const DECIDE_REVENUE_ACTION_SKILL = "revenue.decide_next_action";

export const decideRevenueActionSkill: SkillDefinition<
  RevenueSnapshot,
  RevenueDecision,
  Record<string, never>
> = {
  name: DECIDE_REVENUE_ACTION_SKILL,
  description: "Diagnostica o gargalo do funil e recomenda a próxima ação de receita sem executar efeitos externos.",
  async execute(input) {
    return decideRevenueAction(input);
  },
};
