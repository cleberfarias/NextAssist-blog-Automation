import type { SkillDefinition } from "./types.js";

export class SkillRegistry {
  private readonly skills = new Map<string, SkillDefinition<any, any, any>>();

  register<TInput, TOutput, TContext>(skill: SkillDefinition<TInput, TOutput, TContext>): this {
    if (this.skills.has(skill.name)) throw new Error(`Skill já registrada: ${skill.name}`);
    this.skills.set(skill.name, skill as SkillDefinition<any, any, any>);
    return this;
  }

  get(name: string): SkillDefinition<any, any, any> {
    const skill = this.skills.get(name);
    if (!skill) throw new Error(`Skill não registrada: ${name}`);
    return skill;
  }

  has(name: string): boolean {
    return this.skills.has(name);
  }

  list(): string[] {
    return [...this.skills.keys()].sort();
  }
}
