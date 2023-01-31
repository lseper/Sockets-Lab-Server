import { WebSocketServer, WebSocket } from "ws";
import { v4 } from "uuid";

import { EventType, NominateEvent, VoteEvent, GreetEvent } from "./types";
import type {
	UserType,
	NomineeType,
	NomineesToClientsEventType,
	UpdateActionsLeftToClientEventType,
} from "./types";

const server = new WebSocketServer({ port: 8080 });
const userSockets: Map<string, WebSocket> = new Map<string, WebSocket>();
const users: Map<string, UserType> = new Map<string, UserType>();
const votesBy: Map<string, string[]> = new Map<string, string[]>();
const nominatedBy: Map<string, string[]> = new Map<string, string[]>();
let nominees: NomineeType[] = [];

const MAX_VOTES = 10;
const MAX_NOMINATIONS = 3;

let numUsers = 0;

/**
 * Broadcasting helper methods
 */
const broadcast = <T>(server: WebSocketServer, data: T) => {
	const dataToString = JSON.stringify(data);
	server.clients.forEach((client) => {
		if (client.readyState === WebSocket.OPEN) {
			client.send(dataToString);
		}
	});
};

const reply = <T>(client: WebSocket, data: T) => {
	const dataToString = JSON.stringify(data);
	if (client.readyState === WebSocket.OPEN) {
		client.send(dataToString);
	}
};

const purge = (socket: WebSocket) => {
	const userEntry = [...userSockets.entries()].find((entry) => {
		const [_id, userSocket] = entry;
		return socket === userSocket;
	});
	if (!userEntry) {
		return;
	}
	const id = userEntry[0];
	console.log(`purging user: ${id}`);
	// update any votes from user
	const votesByUser = votesBy.get(id);
	if (votesByUser) {
		votesByUser.forEach((votee) => {
			const nominee = nominees.find((nom) => nom.name === votee);
			if (nominee) {
				nominee.votes -= 1;
			}
		});
	}

	// update nominations
	for (const [nominee, nominators] of nominatedBy.entries()) {
		if (nominators.some((nominator) => nominator === id)) {
			// update nominators for this person
			const newNominators = nominators.filter((n) => n !== id);
			nominatedBy.set(nominee, newNominators);
			// update in nominees
			const nomToFind = nominees.find((nom) => nom.name === nominee);
			if (nomToFind) {
				if (nomToFind.votes === 1) {
					nominees = nominees.filter((nom) => nom.name === nominee);
				} else {
					nomToFind.votes -= 1;
				}
			}
		}
	}
	userSockets.delete(id);
	users.delete(id);
	numUsers -= 1;
};

const getUser = (socket: WebSocket, userID?: string): string => {
	if (!userID) {
		let newUserID = v4();
		// unique user ids
		while (userSockets.get(newUserID)) {
			newUserID = v4();
		}
		const createdUser: UserType = {
			id: newUserID,
			nominations: 0,
			votes: 0,
		};
		// add to uId-socket map
		userSockets.set(newUserID, socket);
		// add to regular users map
		users.set(newUserID, createdUser);
		return newUserID;
	}
	return userID;
};

const nominate = (
	server: WebSocketServer,
	nominater: UserType,
	nomineeName: string
) => {
	console.log("nominate_func info: ", nominater.id, nominater.nominations);
	if (nominater.nominations >= MAX_NOMINATIONS) {
		return;
	}
	if (
		!nominees.some((nominee) => nominee.name === nomineeName) &&
		nominater.username
	) {
		console.log("nominating...");
		nominees.push({
			name: nomineeName,
			votes: 1,
			nominater: nominater.username,
		});
		nominatedBy.set(nomineeName, [nominater.id]);
		nominater.nominations -= 1;
		const nominaterResponseData: NomineesToClientsEventType = {
			nominees: nominees,
			type: "NOMINEES",
		};
		console.log("successfully nominated");
		console.log(nominees, nominatedBy);
		broadcast(server, nominaterResponseData);
	}
};

const unnominate = (
	server: WebSocketServer,
	nominater: UserType,
	nomineeName: string
) => {
	if (nominater.nominations >= MAX_NOMINATIONS) {
		return;
	}
	const candidateNominatedBy = nominatedBy.get(nomineeName);
	if (candidateNominatedBy) {
		const newNominees = candidateNominatedBy.filter(
			(user) => user !== nominater.id
		);
		if (newNominees.length === 0) {
			// remove if no other voters
			nominees = nominees.filter(
				(nominee) => nominee.name !== nomineeName
			);
		} else {
			const nominee = nominees.find((nom) => nom.name === nomineeName);
			if (nominee) {
				const newNominater = users.get(newNominees[0]);
				nominee.nominater = newNominater?.username ?? newNominees[0];
			}
		}
		nominater.nominations += 1;
		const nominaterResponseData: NomineesToClientsEventType = {
			nominees: nominees,
			type: "NOMINEES",
		};
		broadcast(server, nominaterResponseData);
	}
};

const vote = (
	server: WebSocketServer,
	voter: UserType,
	candidate: string,
	upvote: boolean
) => {
	if (upvote && voter.votes >= MAX_VOTES) {
		return;
	}
	const candidateToReceiveVote = nominees.find(
		(nominee) => nominee.name === candidate
	);
	const voterVotes = votesBy.get(voter.id);
	if (candidateToReceiveVote) {
		if (
			!upvote &&
			candidateToReceiveVote.votes > 0 &&
			voterVotes &&
			voterVotes.some((votee) => votee == candidate)
		) {
			// downvote
			candidateToReceiveVote.votes -= 1;
			voter.votes += 1;
			votesBy.set(
				voter.id,
				voterVotes.filter((votee) => votee !== candidate)
			);
			const nominaters = nominatedBy.get(candidate);
			if (nominaters) {
				const lengthBefore = nominaters.length;
				const newNominaters = nominaters.filter(
					(nom) => nom !== voter.id
				);
				if (newNominaters.length < lengthBefore) {
					if (newNominaters.length > 0) {
						const newNominater = users.get(newNominaters[0]);
						candidateToReceiveVote.nominater =
							newNominater?.username ?? newNominaters[0];
					} else {
						nominees = nominees.filter(
							(nominee) => nominee.name !== candidate
						);
					}
				}
			}
		} else {
			// upvote
			// also add as nominee, so that if original nominee unnominates,
			// isn't purged
			const nominatorsToUpdate = nominatedBy.get(candidate);
			if (nominatorsToUpdate) {
				nominatorsToUpdate.push(voter.id);
			}
			candidateToReceiveVote.votes += 1;
			voter.votes -= 1;
			if (!voterVotes) {
				votesBy.set(voter.id, [candidate]);
			} else {
				votesBy.set(voter.id, [...voterVotes, candidate]);
			}
		}
		const nominaterResponseData: NomineesToClientsEventType = {
			nominees: nominees,
			type: "NOMINEES",
		};
		broadcast(server, nominaterResponseData);
	}
};

// do this whenever a user connects
server.on("connection", (response) => {
	numUsers += 1;
	// initialize user id
	const newUserID = getUser(response);
	console.log(`User #${numUsers} has joined! ID: ${newUserID}`);
	reply(response, { id: newUserID, nominees, type: "GREET" });

	// do this whenever a user sends a message
	response.on("message", async (data) => {
		const dataJSON = JSON.parse(data.toString());
		console.log(dataJSON);
		// MAKE SURE YOU SEND MESSAGES WITH A TYPE FIELD!
		const messageType = dataJSON.type;
		switch (messageType) {
			case EventType.enum.NOMINATE: {
				const result = NominateEvent.safeParse(dataJSON);
				if (!result.success) {
					break;
				}
				const nominater = users.get(result.data.nominater);
				const { nominee } = result.data;
				if (nominater && nominater.username) {
					console.log("Nominater exists");
					if (result.data.unnominate) {
						console.log("stepping into unnominate...");
						unnominate(server, nominater, nominee);
					} else {
						console.log("stepping into nominate...");
						nominate(server, nominater, nominee);
					}
					const nominaterResponseData: UpdateActionsLeftToClientEventType =
						{ user: nominater, type: "UPDATE" };
					reply(response, nominaterResponseData);
				}
				break;
			}
			case EventType.enum.VOTE: {
				const result = VoteEvent.safeParse(dataJSON);
				if (!result.success) {
					break;
				}
				const voter = users.get(result.data.voter);
				const { upvote, candidate } = result.data;
				if (voter && voter.username) {
					vote(server, voter, candidate, upvote);
					const voterResponseData: UpdateActionsLeftToClientEventType =
						{ user: voter, type: "UPDATE" };
					reply(response, voterResponseData);
				}
				break;
			}
			case EventType.enum.GREET: {
				const result = GreetEvent.safeParse(dataJSON);
				if (!result.success) {
					break;
				}
				const user = users.get(result.data.id);
				if (!user) {
					break;
				}
				user.username = result.data.username;
				break;
			}
		}
	});

	response.on("close", (_) => {
		purge(response);
	});
});
