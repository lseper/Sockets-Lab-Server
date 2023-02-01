import { z } from "zod";

export const User = z.object({
	id: z.string(),
	username: z.optional(z.string()),
	nominations: z.number(),
	votes: z.number(),
});

export const Nominee = z.object({
	name: z.string(),
	votes: z.number(),
	nominater: User,
});

export const EventType = z.enum(["GREET", "NOMINATE", "VOTE"]);

export const GreetEvent = z.object({
	id: z.string(),
	username: z.string(),
});

export const NominateEvent = z.object({
	nominee: z.string(),
	nominater: z.string(),
	unnominate: z.boolean(),
});
export const VoteEvent = z.object({
	candidate: z.string(),
	voter: z.string(),
	upvote: z.boolean(),
});

export type UserType = z.infer<typeof User>;
export type NomineeType = z.infer<typeof Nominee>;

// TO-SERVER Types
export const GreetEventToClient = z.object({
	id: z.string(),
	nominees: z.array(Nominee),
});
export const NomineesToClients = z.object({
	nominees: z.array(Nominee),
	type: z.literal("NOMINEES"),
});
export const UpdateActionsLeftToClient = z.object({
	user: User,
	type: z.literal("UPDATE"),
});
export type GreetEventType = z.infer<typeof GreetEvent>;
export type NominateEventType = z.infer<typeof NominateEvent>;
export type VoteEventType = z.infer<typeof VoteEvent>;

// TO-CLIENT Types
export type NomineesToClientsEventType = z.infer<typeof NomineesToClients>;
export type UpdateActionsLeftToClientEventType = z.infer<
	typeof UpdateActionsLeftToClient
>;
