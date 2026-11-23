import type { Io } from "../output";

export interface CommandOption {
  name: string;
  type: "string" | "boolean";
  description: string;
  // Can be given several times (the command receives a string[]).
  multiple?: boolean;
  default?: string | boolean;
}

export interface Subcommand {
  name: string;
  usage: string;
  summary: string;
  // Changes project files (prints a plan unless --yes when destructive).
  writes?: boolean;
  destructive?: boolean;
}

export type OptionValue = string | boolean | string[] | undefined;

export interface CommandContext {
  io: Io;
  options: Record<string, OptionValue>;
  positionals: string[];
}

export interface Command {
  name: string;
  // Usage line after `agentphoto`, e.g. "serve [--port <n>]".
  usage: string;
  summary: string;
  options: CommandOption[];
  // Actions of a command group (`scene get|summary|…`), listed by `help --json`.
  subcommands?: Subcommand[];
  // Changes project files (top-level commands without subcommands).
  writes?: boolean;
  run(ctx: CommandContext): Promise<number | void>;
}
