import { WebSocketServer, WebSocket } from "ws";
import { v4 } from "uuid";

import { EventType, NominateEvent, VoteEvent, GreetEvent } from "./types";
import type {
	UserType,
	NomineeType,
	NomineesToClientsEventType,
	UpdateActionsLeftToClientEventType,
	NominateEventType,
	VoteEventType,
	GreetEventType,
	EventTypeType
} from "./types";

const server = new WebSocketServer({ port: 8080 });
const userSockets: Map<string, WebSocket> = new Map<string, WebSocket>();
const users: Map<string, UserType> = new Map<string, UserType>();
const votesBy: Map<string, string[]> = new Map<string, string[]>();
let nominees: NomineeType[] = [];

const STARTING_VOTES = 10;
const STARTING_NOMINATIONS = 3;

let numUsers = 0;

const logNominee = (nominee: NomineeType, depth=2) => {
	const d = '\t'.repeat(depth);
	console.log(`${d}NOMINEE: ${nominee.name}`)
	console.log(`\t${d}votes: ${nominee.votes}`)
	console.log(`\t${d}nominater: ${nominee.nominater.username ?? 'User#' + nominee.nominater.id}`)
}

const logNominees = (depth=1) => {
	const d = '\t'.repeat(1);
	console.log(`${d}ALL NOMINEES`);
	nominees.forEach(nominee => {
		logNominee(nominee);
	})
}

const logUser = (user: UserType) => {
	console.log(`\tLOGGING USER: ${user.username ?? 'undefined'}`)
	console.log(`\t\tid: ${user.id}`)
	console.log(`\t\tnominations remaining: ${user.nominations}`)
	console.log(`\t\tNOMINATIONS`)
	const userNominations = nominees.filter(nominee => nominee.nominater.id !== user.id).forEach(nominee => {
		console.log(`\t\t\t${nominee.name}`)
	});
	console.log(`\t\tvotes remaining: ${user.votes}`);
	console.log(`\t\tVOTES`);
	const userVotes = votesBy.get(user.id);
	if (userVotes) {
		userVotes.forEach(nominee => {
			console.log(`\t\t\t${nominee}`)
		})
	}
}

const logUsers = () => {
	console.log('CONNECTED USERS');
	users.forEach(user => {
		logUser(user);
	})

} 

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
	console.log(`\tpurging user: ${users.get(id)?.username ?? 'NO_USERNAME'}`);
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

	// return votes to users who voted for nominee
	const nomineesToUnnominate = nominees.filter(
		(nom) => nom.nominater.id === id
	);
	nomineesToUnnominate.forEach((nomineeToUnnominate) => {
		_return_votes(nomineeToUnnominate);
		_remove_votes_for_nominee(nomineeToUnnominate);
	});
	// update nominees nominated
	nominees = nominees.filter((nom) => nom.nominater.id !== id);
	broadcast(server, { type: "NOMINEES", nominees });
	votesBy.delete(id);
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
			nominations: STARTING_NOMINATIONS,
			votes: STARTING_VOTES,
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
	if (nominater.nominations <= 0) {
		return;
	}
	if (
		!nominees.some((nominee) => nominee.name === nomineeName) &&
		nominater.username
	) {
		nominees.push({
			name: nomineeName,
			votes: 0,
			nominater: nominater,
		});
		nominater.nominations -= 1;
		const nominaterResponseData: NomineesToClientsEventType = {
			nominees: nominees,
			type: "NOMINEES",
		};
		broadcast(server, nominaterResponseData);
	}
};

const _remove_votes_for_nominee = (unnominated: NomineeType): void => {
	[...votesBy.entries()].forEach((entry) => {
		const [userID, votedFor] = entry;
		votesBy.set(
			userID,
			votedFor.filter((nom) => nom !== unnominated.name)
		);
	});
};

const _return_votes = (unnominated: NomineeType): void => {
	const usersToReplyTo: UserType[] = [];
	[...votesBy.entries()].forEach((entry) => {
		const [userID, usersVotedFor] = entry;
		const userToUpdate = users.get(userID);
		if (userToUpdate) {
			console.log(
				`\tScanning if ${userToUpdate.username} voted for ${unnominated.name}...`
			);
			const numberOfVotesToReturn = usersVotedFor.filter(
				(nom) => nom === unnominated.name
			).length;
			console.log(
				`\tReturning ${numberOfVotesToReturn} votes (${
					userToUpdate.votes
				} -> ${userToUpdate.votes + numberOfVotesToReturn})`
			);
			userToUpdate.votes += numberOfVotesToReturn;
			usersToReplyTo.push(userToUpdate);
		}
	});
	// give vote back to nominater
	// const nominaterIncluded = usersToReplyTo.find(
	// 	(user) => user.id === unnominated.nominater.id
	// );
	// if (!nominaterIncluded) {
	// 	const nominaterToGiveVotesBack = users.get(unnominated.nominater.id);
	// 	if (nominaterToGiveVotesBack) {
	// 		nominaterToGiveVotesBack.votes += 1;
	// 		usersToReplyTo.push(nominaterToGiveVotesBack);
	// 	}
	// }
	// update votes on user
	usersToReplyTo.forEach((user) => {
		const userSocket = userSockets.get(user.id);
		if (userSocket) {
			console.log(`\t${user.username}'s updated votes: ${user.votes}`);
			reply(userSocket, { type: "UPDATE", user: user });
		}
	});
};

const unnominate = (
	server: WebSocketServer,
	nominater: UserType,
	nomineeName: string
) => {
	if (nominater.nominations >= STARTING_NOMINATIONS) {
		return;
	}
	const nomineeToUnnominate = nominees.find(
		(nom) => nom.name === nomineeName
	);
	if (
		nomineeToUnnominate &&
		nomineeToUnnominate.nominater.id === nominater.id
	) {
		nominater.nominations += 1;
		nominees = nominees.filter((nom) => nom.name !== nomineeName);
		const nominaterResponseData: NomineesToClientsEventType = {
			nominees: nominees,
			type: "NOMINEES",
		};
		_return_votes(nomineeToUnnominate);
		// remove votes for that nominee in votesBy
		_remove_votes_for_nominee(nomineeToUnnominate);
		broadcast(server, nominaterResponseData);
	}
};

const vote = (
	server: WebSocketServer,
	voter: UserType,
	candidate: string,
	upvote: boolean
) => {
	if (upvote && voter.votes <= 0) {
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
			// remove one vote
			const firstOccurrenceOfCandidate = voterVotes.findIndex(
				(nom) => nom === candidate
			);
			if (firstOccurrenceOfCandidate !== -1) {
				// bounds check
				let newCandidatesVotedByVoter = voterVotes.slice(
					0,
					firstOccurrenceOfCandidate
				);
				if (firstOccurrenceOfCandidate !== voterVotes.length - 1) {
					newCandidatesVotedByVoter.push(
						...voterVotes.slice(firstOccurrenceOfCandidate + 1)
					);
				}
				votesBy.set(voter.id, newCandidatesVotedByVoter);
			}
		} else if (upvote) {
			// upvote
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
		// console.log(dataJSON);
		// MAKE SURE YOU SEND MESSAGES WITH A TYPE FIELD!
		const messageType = dataJSON.type;
		switch (messageType) {
			case EventType.enum.HEARTBEAT: {
				console.log('Received Heartbeat');
				reply(response, { type: "HEARTBEAT" })
				break;
			}
			case EventType.enum.NOMINATE: {
				console.log("NOMINATION")
				const result = NominateEvent.safeParse(dataJSON);
				if (!result.success) {
					break;
				}
				const nominater = users.get(result.data.nominater);
				const { nominee } = result.data;
				if (nominater && nominater.username) {
					if (result.data.unnominate) {
						unnominate(server, nominater, nominee);
					} else {
						nominate(server, nominater, nominee);
					}
					const nominaterResponseData: UpdateActionsLeftToClientEventType =
						{ user: nominater, type: "UPDATE" };
					logNominees();
					logUser(nominater);
					reply(response, nominaterResponseData);
				}
				break;
			}
			case EventType.enum.VOTE: {
				console.log("VOTE")
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
					const nomToLog = nominees.find(nom => nom.name === candidate);
					if(nomToLog) {
						logNominee(nomToLog);	
					}
					logUser(voter);
					reply(response, voterResponseData);
				}
				break;
			}
			case EventType.enum.GREET: {
				console.log("GREET")
				const result = GreetEvent.safeParse(dataJSON);
				if (!result.success) {
					break;
				}
				const user = users.get(result.data.id);
				if (!user) {
					break;
				}
				user.username = result.data.username;
				logUser(user)
				break;
			}
		}
	});

	response.on("close", (_) => {
		console.log('DISCONNECTION')
		purge(response);
		logUsers();
	});
});
