import type { UserData } from "./user-data.ts";

export type TagDirection =
	| "forward"
	| "reverse"
	| "ping-pong"
	| "ping-pong-reverse";

export type Tag = {
	name: string;
	from: number;
	to: number;
	direction: TagDirection;
	repeat: number;
	userData: UserData;
};
