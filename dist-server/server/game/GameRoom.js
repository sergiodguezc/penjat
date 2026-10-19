import { displayWord, isCorrectGuess, isWordComplete, MAX_ERRORS, normalizeGuess, validateSecretWord } from '../../shared/game.js';
import { MAX_ROOM_PLAYERS, REACTION_TYPES } from '../../shared/protocol.js';
import { randomUUID } from 'node:crypto';
const MAX_CHAT_MESSAGES = 50;
const MAX_CHAT_LENGTH = 300;
export class GameRoom {
    code;
    language;
    voltes;
    random;
    players = [];
    roomStatus = 'waiting';
    hostId = null;
    rematchReady = new Set();
    matchRosterIds = [];
    turnIndex = 0;
    currentRound = null;
    matchResult = null;
    observerBySetter = new Map();
    chatMessages = [];
    reconnectedPlayerName;
    disconnectedPlayerName;
    constructor(code, language, voltes, random = Math.random) {
        this.code = code;
        this.language = language;
        this.voltes = voltes;
        this.random = random;
    }
    /** Seated members, including players who are away; only an explicit leave gives up the seat. */
    get activePlayers() { return this.players.filter((player) => player.active); }
    /** Members the game can wait for: connected, or reconnecting within the grace period. Away players are skipped. */
    get presentPlayers() { return this.players.filter((player) => this.isPresent(player.id)); }
    get connectedPlayers() { return this.players.filter((player) => player.active && player.connectionState === 'connected'); }
    get acceptingPlayers() { return this.roomStatus === 'waiting' && this.activePlayers.length < MAX_ROOM_PLAYERS; }
    get totalTurns() { return this.matchRosterIds.length * this.voltes; }
    get completedTurns() { return this.roomStatus === 'waiting' ? 0 : Math.min(this.turnIndex + (this.currentRound?.status === 'round-over' ? 1 : 0), this.totalTurns); }
    addPlayer(id, socketId, reconnectToken, name) {
        if (!this.acceptingPlayers)
            throw new Error(this.roomStatus === 'waiting' ? 'room-full' : 'match-started');
        this.players.push({ id, socketId, reconnectToken, name, score: 0, connectionState: 'connected', active: true, joinedAt: Date.now() });
        if (!this.hostId)
            this.hostId = id;
    }
    player(id) { return this.players.find((player) => player.id === id); }
    start(playerId) {
        if (this.roomStatus !== 'waiting')
            throw new Error('cannot-start');
        if (playerId !== this.hostId)
            throw new Error('not-host');
        if (this.presentPlayers.length < 2)
            throw new Error('not-enough-players');
        // Away players keep their place in the rotation; their turns are skipped until they return.
        this.matchRosterIds = this.activePlayers.map((player) => player.id);
        const firstSetterIndex = Math.floor(this.random() * this.matchRosterIds.length);
        this.matchRosterIds = this.matchRosterIds.slice(firstSetterIndex).concat(this.matchRosterIds.slice(0, firstSetterIndex));
        this.turnIndex = 0;
        this.matchResult = null;
        this.rematchReady.clear();
        for (const player of this.players)
            player.score = 0;
        this.roomStatus = 'active';
        this.startNextTurn();
    }
    markReconnecting(playerId, socketId) {
        const player = this.player(playerId);
        if (!player || !player.active || player.socketId !== socketId)
            return false;
        player.socketId = null;
        player.connectionState = 'reconnecting';
        this.reconnectedPlayerName = undefined;
        return true;
    }
    resume(playerId, reconnectToken, socketId) {
        const player = this.player(playerId);
        if (!player || !player.active || player.reconnectToken !== reconnectToken)
            throw new Error('resume-rejected');
        const wasAway = player.connectionState === 'disconnected';
        player.socketId = socketId;
        player.connectionState = 'connected';
        this.reconnectedPlayerName = player.name;
        // Nothing is undone: a returning player keeps any turn result, and joins the current turn only before its word is set.
        const state = this.currentRound?.playerStates.get(playerId);
        if (wasAway && this.roomStatus === 'active' && this.currentRound?.status === 'choosing-word' && state?.sittingOut) {
            this.currentRound.playerStates.set(playerId, this.newPlayerRoundState(playerId));
        }
        this.ensurePresentHost();
        return player;
    }
    /** The reconnect grace period ran out: the seat, identity and score stay, but the game stops waiting for this player. */
    markAway(playerId) {
        const player = this.player(playerId);
        if (!player?.active || player.connectionState !== 'reconnecting')
            return false;
        player.connectionState = 'disconnected';
        this.disconnectedPlayerName = player.name;
        this.releaseFromPlay(playerId, false);
        return true;
    }
    setWord(playerId, input) {
        const round = this.requireRound('choosing-word');
        if (playerId !== round.setterId)
            throw new Error('not-word-setter');
        this.requireConnected(playerId);
        const word = validateSecretWord(input, this.language);
        if (!word)
            throw new Error('invalid-word');
        round.secretWord = word;
        round.status = 'guessing';
        const startedAt = Date.now();
        for (const state of round.playerStates.values()) {
            // A guesser who left during word selection is already eliminated; reopening them would stall the round.
            if (this.isTerminal(state.status))
                continue;
            state.status = 'playing';
            state.startedAt = startedAt;
        }
        this.maybeFinishRound();
    }
    guess(playerId, input) {
        const round = this.requireRound('guessing');
        const state = round.playerStates.get(playerId);
        if (!state || state.status !== 'playing')
            throw new Error('not-guesser');
        this.requireConnected(playerId);
        if (typeof input !== 'string')
            throw new Error('invalid-guess');
        const guess = normalizeGuess(input, this.language);
        if (!guess)
            throw new Error('invalid-guess');
        if (state.guessedLetters.has(guess))
            return;
        state.guessedLetters.add(guess);
        if (isWordComplete(round.secretWord, state.guessedLetters, this.language)) {
            this.finishPlayer(state, 'solved');
            this.maybeFinishRound();
            return;
        }
        if (!isCorrectGuess(round.secretWord, guess, this.language)) {
            state.errors += 1;
            if (!state.forgiven && state.errors >= MAX_ERRORS) {
                state.status = 'awaiting-forgiveness';
                this.createForgivenessRequest(round, state.playerId);
            }
            else if (state.forgiven && state.errors > MAX_ERRORS) {
                this.finishPlayer(state, 'eliminated');
            }
        }
        this.maybeFinishRound();
    }
    decideForgiveness(playerId, requestId, forgive) {
        const round = this.requireRound('guessing');
        if (playerId !== round.setterId)
            throw new Error('cannot-decide-forgiveness');
        this.requireConnected(playerId);
        if (typeof requestId !== 'string' || typeof forgive !== 'boolean')
            throw new Error('invalid-forgiveness');
        const request = round.forgivenessRequests.get(requestId);
        if (!request || request.roundId !== round.id || request.status !== 'pending')
            throw new Error('cannot-decide-forgiveness');
        const state = round.playerStates.get(request.playerId);
        if (!state || state.status !== 'awaiting-forgiveness')
            throw new Error('cannot-decide-forgiveness');
        request.status = forgive ? 'granted' : 'denied';
        request.decidedAt = Date.now();
        if (forgive) {
            state.forgiven = true;
            state.status = 'playing';
        }
        else {
            this.finishPlayer(state, 'failed');
        }
        this.maybeFinishRound();
    }
    observePlayer(setterId, observedPlayerId) {
        const round = this.requireRound();
        if (setterId !== round.setterId)
            throw new Error('not-word-setter');
        this.requireConnected(setterId);
        const observed = round.playerStates.get(observedPlayerId);
        if (!observed || observedPlayerId === setterId)
            throw new Error('invalid-observed-player');
        this.observerBySetter.set(setterId, observedPlayerId);
    }
    continue(playerId) {
        this.requireRound('round-over');
        const nextSetterId = this.nextActiveSetterId();
        if (playerId !== nextSetterId)
            throw new Error('cannot-continue');
        this.requireConnected(playerId);
        this.turnIndex += 1;
        this.startNextTurn();
    }
    requestRematch(playerId) {
        if (this.roomStatus !== 'match-over' || !this.player(playerId)?.active)
            throw new Error('cannot-rematch');
        this.requireConnected(playerId);
        if (this.rematchReady.has(playerId))
            throw new Error('rematch-already-ready');
        this.rematchReady.add(playerId);
        this.maybeStartRematch();
    }
    /** Explicit departure: the seat is given up for good. */
    disconnect(playerId) {
        const leaving = this.player(playerId);
        if (!leaving || !leaving.active)
            return;
        leaving.active = false;
        leaving.socketId = null;
        leaving.connectionState = 'disconnected';
        this.disconnectedPlayerName = leaving.name;
        this.releaseFromPlay(playerId, true);
    }
    /**
     * Reconnecting players whose absence stops the room from moving on: a host the lobby needs to start, a setter choosing
     * a word or holding a forgiveness decision, guessers when no connected player can still act in the round, the next
     * setter at the end of a turn, and the last players a rematch is waiting for. Anything else simply carries on.
     */
    blockingPlayerIds() {
        const reconnecting = (id) => Boolean(id && this.player(id)?.active && this.player(id)?.connectionState === 'reconnecting');
        const connected = (id) => this.player(id)?.active && this.player(id)?.connectionState === 'connected';
        const blocking = new Set();
        const round = this.currentRound;
        if (this.roomStatus === 'waiting' && reconnecting(this.hostId))
            blocking.add(this.hostId);
        if (this.roomStatus === 'active' && round) {
            if (round.status === 'choosing-word' && reconnecting(round.setterId))
                blocking.add(round.setterId);
            if (round.status === 'guessing') {
                const pending = [...round.forgivenessRequests.values()].filter((request) => request.status === 'pending');
                if (pending.length && reconnecting(round.setterId))
                    blocking.add(round.setterId);
                const open = [...round.playerStates.values()].filter((state) => !this.isTerminal(state.status));
                const someoneCanAct = open.some((state) => connected(state.playerId) && (state.status === 'playing' || connected(round.setterId)));
                if (!someoneCanAct)
                    for (const state of open)
                        if (reconnecting(state.playerId))
                            blocking.add(state.playerId);
            }
            if (round.status === 'round-over') {
                const next = this.nextActiveSetterId();
                if (reconnecting(next))
                    blocking.add(next);
            }
        }
        if (this.roomStatus === 'match-over') {
            const waitingFor = this.presentPlayers.filter((player) => !this.rematchReady.has(player.id));
            if (this.presentPlayers.length >= 2 && waitingFor.length && waitingFor.every((player) => player.connectionState === 'reconnecting'))
                for (const player of waitingFor)
                    blocking.add(player.id);
        }
        return [...blocking];
    }
    /** The host (or, if the host is the one missing, the first connected member) may continue without a blocking player,
     and so may whoever would take over that player's turn as setter. */
    canContinueWithout(actorId, targetId) {
        const actor = this.player(actorId);
        if (actorId === targetId || !actor?.active || actor.connectionState !== 'connected' || !this.blockingPlayerIds().includes(targetId))
            return false;
        const host = this.player(this.hostId ?? '');
        const effectiveHost = host && host.id !== targetId && host.active && host.connectionState === 'connected' ? host.id : this.connectedPlayers.find((player) => player.id !== targetId)?.id;
        if (actorId === effectiveHost)
            return true;
        const round = this.currentRound;
        const holdsTurn = round && this.roomStatus === 'active' && ((round.status === 'choosing-word' && round.setterId === targetId) || (round.status === 'round-over' && this.nextActiveSetterId() === targetId));
        return Boolean(holdsTurn && this.successorSetter(targetId) === actorId);
    }
    /** Applies the away handling now instead of at the end of the grace period. A player who already came back wins. */
    continueWithout(actorId, targetId) {
        const target = this.player(targetId);
        if (!target?.active)
            throw new Error('invalid-skip');
        if (target.connectionState === 'connected')
            throw new Error('player-reconnected');
        if (target.connectionState === 'disconnected')
            return false;
        if (!this.canContinueWithout(actorId, targetId))
            throw new Error('cannot-skip-player');
        return this.markAway(targetId);
    }
    successorSetter(skippedId) {
        for (let index = this.turnIndex + 1; index < this.totalTurns; index += 1) {
            const id = this.matchRosterIds[index % this.matchRosterIds.length];
            if (id !== skippedId && this.isPresent(id))
                return id;
        }
        return null;
    }
    /** Shared by departure and absence: whatever was waiting on this player moves on (host, turn, guess, rematch). */
    releaseFromPlay(playerId, departing) {
        this.rematchReady.delete(playerId);
        this.ensurePresentHost();
        const round = this.currentRound;
        if (this.roomStatus === 'active' && round) {
            if (round.setterId === playerId) {
                if (round.status !== 'round-over')
                    this.cancelCurrentTurn();
                else
                    this.advanceAfterCompletedTurn();
            }
            else {
                const state = round.playerStates.get(playerId);
                if (state && !this.isTerminal(state.status)) {
                    this.finishPlayer(state, 'eliminated');
                    state.absent = !departing;
                    // Away before the word was set: they never played this turn, so they watch it unscored and may still rejoin it.
                    if (!departing && round.status === 'choosing-word')
                        state.sittingOut = true;
                    for (const request of round.forgivenessRequests.values()) {
                        if (request.playerId === playerId && request.status === 'pending') {
                            request.status = 'cancelled';
                            request.decidedAt = Date.now();
                        }
                    }
                    this.maybeFinishRound();
                }
            }
            if (this.presentPlayers.length < 2 || (this.currentRound?.status === 'round-over' && this.nextActiveSetterId() === null))
                this.finishMatch();
        }
        if (this.roomStatus === 'match-over')
            this.maybeStartRematch();
    }
    /** One host at a time: the role moves to the first connected member only when the host is gone or away. */
    ensurePresentHost() {
        const host = this.hostId ? this.player(this.hostId) : undefined;
        if (host?.active && host.connectionState !== 'disconnected')
            return;
        // Nobody connected: an away host keeps the role until someone returns (a departed one passes it to any seat).
        this.hostId = this.connectedPlayers[0]?.id ?? (host?.active ? host.id : this.presentPlayers[0]?.id ?? this.activePlayers[0]?.id ?? null);
    }
    maybeStartRematch() {
        const eligible = this.presentPlayers.map((player) => player.id);
        if (eligible.length >= 2 && eligible.every((id) => this.rematchReady.has(id)))
            this.startRematch();
    }
    addChatMessage(playerId, input) {
        const sender = this.player(playerId);
        if (!sender?.active)
            throw new Error('not-room-member');
        if (typeof input !== 'string')
            throw new Error('invalid-chat-message');
        const text = input.trim();
        if (!text)
            throw new Error('empty-chat-message');
        if (text.length > MAX_CHAT_LENGTH)
            throw new Error('chat-message-too-long');
        const reactions = { '❤️': [], '😂': [], '💀': [] };
        const message = { id: randomUUID(), senderId: sender.id, senderName: sender.name, text, timestamp: Date.now(), reactions };
        this.chatMessages.push(message);
        if (this.chatMessages.length > MAX_CHAT_MESSAGES)
            this.chatMessages.splice(0, this.chatMessages.length - MAX_CHAT_MESSAGES);
        return message;
    }
    toggleChatReaction(playerId, messageId, reaction) {
        if (!this.player(playerId)?.active)
            throw new Error('not-room-member');
        if (typeof messageId !== 'string')
            throw new Error('invalid-chat-message');
        if (typeof reaction !== 'string' || !REACTION_TYPES.includes(reaction))
            throw new Error('invalid-reaction');
        const message = this.chatMessages.find((candidate) => candidate.id === messageId);
        if (!message)
            throw new Error('chat-message-not-found');
        const members = message.reactions[reaction];
        const index = members.indexOf(playerId);
        if (index === -1)
            members.push(playerId);
        else
            members.splice(index, 1);
        return { messageId, reactions: message.reactions };
    }
    get chatHistory() { return [...this.chatMessages]; }
    viewFor(playerId) {
        const round = this.currentRound;
        const selfState = round?.playerStates.get(playerId);
        const isSetter = round?.setterId === playerId;
        const publicPlayers = this.players.map((player) => ({
            id: player.id, name: player.name, score: player.score, connectionState: player.connectionState, active: player.active,
            roundStatus: this.publicRoundStatus(player.id),
        }));
        const match = {
            status: this.roomStatus, ownerId: this.hostId ?? '', turnOrder: [...this.matchRosterIds], turnIndex: this.turnIndex,
            voltaNumber: this.matchRosterIds.length ? Math.min(this.voltes, Math.floor(this.turnIndex / this.matchRosterIds.length) + 1) : 0,
            completedTurns: this.completedTurns, totalTurns: this.totalTurns, rematchReadyPlayerIds: [...this.rematchReady],
        };
        const privateSelf = round && selfState ? this.playerRoundView(round, selfState, this.shouldReveal(round)) : null;
        const view = {
            code: this.code, gameLanguage: this.language, voltes: this.voltes, players: publicPlayers, roomStatus: this.roomStatus, hostId: this.hostId,
            match, round: round ? this.roundView(round) : null, self: privateSelf,
            observedPlayerId: isSetter ? this.observerBySetter.get(playerId) ?? null : null,
            forgivenessRequests: isSetter && round ? [...round.forgivenessRequests.values()] : [], matchResult: this.matchResult,
            reconnectedPlayerName: this.reconnectedPlayerName, disconnectedPlayerName: this.disconnectedPlayerName,
            skippablePlayerIds: this.blockingPlayerIds().filter((targetId) => this.canContinueWithout(playerId, targetId)),
        };
        const observedId = isSetter ? this.observerBySetter.get(playerId) : undefined;
        const observedState = observedId ? round?.playerStates.get(observedId) : undefined;
        if (round && observedState && isSetter)
            view.observedPlayer = this.playerRoundView(round, observedState, this.shouldReveal(round));
        if (round?.secretWord && (isSetter || this.shouldReveal(round)))
            view.privateWord = round.secretWord;
        return view;
    }
    startRematch() {
        for (const player of this.players)
            player.score = 0;
        this.matchRosterIds = [];
        this.turnIndex = 0;
        this.currentRound = null;
        this.matchResult = null;
        this.rematchReady.clear();
        this.roomStatus = 'waiting';
        this.start(this.hostId ?? this.presentPlayers[0]?.id ?? '');
    }
    startNextTurn() {
        while (this.turnIndex < this.totalTurns) {
            const setterId = this.matchRosterIds[this.turnIndex % this.matchRosterIds.length];
            if (!this.isPresent(setterId)) {
                this.turnIndex += 1;
                continue;
            }
            const playerStates = new Map();
            for (const id of this.matchRosterIds) {
                if (id === setterId || !this.player(id)?.active)
                    continue;
                playerStates.set(id, this.isPresent(id) ? this.newPlayerRoundState(id) : { ...this.newPlayerRoundState(id), status: 'eliminated', sittingOut: true });
            }
            this.currentRound = { id: randomUUID(), number: this.turnIndex + 1, voltaNumber: Math.floor(this.turnIndex / this.matchRosterIds.length) + 1, setterId, secretWord: null, status: 'choosing-word', playerStates, forgivenessRequests: new Map(), ranking: [], results: [] };
            const firstGuesserId = [...playerStates.values()].find((state) => !state.sittingOut)?.playerId;
            if (firstGuesserId)
                this.observerBySetter.set(setterId, firstGuesserId);
            else
                this.observerBySetter.delete(setterId);
            return;
        }
        this.finishMatch();
    }
    newPlayerRoundState(playerId) {
        return { playerId, status: 'playing', guessedLetters: new Set(), errors: 0, forgiven: false, startedAt: null, finishedAt: null, resolutionTimeMs: null, roundRank: null, sittingOut: false, absent: false };
    }
    createForgivenessRequest(round, playerId) {
        const request = { id: randomUUID(), roundId: round.id, playerId, setterId: round.setterId, status: 'pending', createdAt: Date.now(), decidedAt: null };
        round.forgivenessRequests.set(request.id, request);
    }
    finishPlayer(state, status) {
        state.status = status;
        state.finishedAt ??= Date.now();
        state.resolutionTimeMs = state.startedAt === null ? null : state.finishedAt - state.startedAt;
    }
    maybeFinishRound() {
        const round = this.currentRound;
        if (!round || round.status !== 'guessing' || [...round.playerStates.values()].some((state) => !this.isTerminal(state.status)))
            return;
        round.status = 'round-over';
        const scored = [...round.playerStates.values()].filter((state) => !state.sittingOut);
        round.ranking = scored.sort((a, b) => this.compareRoundStates(a, b)).map((state) => state.playerId);
        const guesserCount = scored.length;
        round.results = round.ranking.map((playerId, index) => {
            const state = round.playerStates.get(playerId);
            state.roundRank = index + 1;
            const player = this.player(playerId);
            const pointsAwarded = state.status === 'solved' ? guesserCount - index : 0;
            if (player)
                player.score += pointsAwarded;
            return {
                playerId,
                position: index + 1,
                status: state.status,
                forgiven: state.forgiven,
                errors: state.errors,
                resolutionTimeMs: state.resolutionTimeMs,
                pointsAwarded,
            };
        });
        round.results.push({ playerId: round.setterId, position: null, status: 'setter', forgiven: false, errors: null, resolutionTimeMs: null, pointsAwarded: 0 });
        // No remaining turn has an active setter (including the last turn): nobody could continue, so the match ends.
        if (this.presentPlayers.length < 2 || this.nextActiveSetterId() === null)
            this.finishMatch();
    }
    compareRoundStates(a, b) {
        const solvedDifference = Number(b.status === 'solved') - Number(a.status === 'solved');
        if (solvedDifference)
            return solvedDifference;
        if (a.errors !== b.errors)
            return a.errors - b.errors;
        const aTime = a.resolutionTimeMs ?? Number.POSITIVE_INFINITY;
        const bTime = b.resolutionTimeMs ?? Number.POSITIVE_INFINITY;
        if (aTime !== bTime)
            return aTime - bTime;
        return this.matchRosterIds.indexOf(a.playerId) - this.matchRosterIds.indexOf(b.playerId);
    }
    finishMatch() {
        if (this.roomStatus === 'match-over')
            return;
        const ranking = [...this.matchRosterIds].sort((a, b) => (this.player(b)?.score ?? 0) - (this.player(a)?.score ?? 0) || this.matchRosterIds.indexOf(a) - this.matchRosterIds.indexOf(b));
        const scores = {};
        for (const player of this.players)
            scores[player.id] = player.score;
        this.matchResult = { ranking, scores };
        this.roomStatus = 'match-over';
        this.rematchReady.clear();
    }
    cancelCurrentTurn() {
        const round = this.currentRound;
        if (!round)
            return;
        for (const request of round.forgivenessRequests.values())
            if (request.status === 'pending') {
                request.status = 'cancelled';
                request.decidedAt = Date.now();
            }
        round.status = 'round-over';
        round.ranking = [];
        round.results = [{ playerId: round.setterId, position: null, status: 'setter', forgiven: false, errors: null, resolutionTimeMs: null, pointsAwarded: 0 }];
        this.advanceAfterCompletedTurn();
    }
    advanceAfterCompletedTurn() {
        this.turnIndex += 1;
        if (this.presentPlayers.length < 2)
            this.finishMatch();
        else
            this.startNextTurn();
    }
    nextActiveSetterId() {
        for (let index = this.turnIndex + 1; index < this.totalTurns; index += 1) {
            const id = this.matchRosterIds[index % this.matchRosterIds.length];
            if (this.isPresent(id))
                return id;
        }
        return null;
    }
    requireRound(status) {
        if (this.roomStatus !== 'active' || !this.currentRound || (status && this.currentRound.status !== status))
            throw new Error(status === 'round-over' ? 'cannot-continue' : 'not-available');
        return this.currentRound;
    }
    requireConnected(playerId) {
        const player = this.player(playerId);
        if (!player?.active || player.connectionState !== 'connected')
            throw new Error('player-reconnecting');
    }
    isPresent(playerId) {
        const player = this.player(playerId);
        return Boolean(player?.active && player.connectionState !== 'disconnected');
    }
    isTerminal(status) { return status === 'solved' || status === 'failed' || status === 'eliminated'; }
    shouldReveal(round) { return round.status === 'round-over' || this.roomStatus === 'match-over'; }
    publicRoundStatus(playerId) {
        if (!this.player(playerId)?.active)
            return 'eliminated';
        const round = this.currentRound;
        if (round?.setterId === playerId)
            return 'setter';
        const state = round?.playerStates.get(playerId);
        return state?.sittingOut || state?.absent ? 'spectating' : state?.status ?? 'playing';
    }
    roundView(round) {
        return { id: round.id, number: round.number, voltaNumber: round.voltaNumber, setterId: round.setterId, nextSetterId: this.nextActiveSetterId(), status: round.status, ranking: [...round.ranking], results: round.results.map((result) => ({ ...result })) };
    }
    playerRoundView(round, state, reveal) {
        const guessedLetters = [...state.guessedLetters];
        return {
            playerId: state.playerId, status: state.status, guessedLetters, wrongLetters: round.secretWord ? guessedLetters.filter((guess) => !isCorrectGuess(round.secretWord, guess, this.language)) : [], errors: state.errors,
            displayWord: round.secretWord ? displayWord(round.secretWord, state.guessedLetters, this.language, reveal) : [], forgiven: state.forgiven,
            startedAt: state.startedAt, finishedAt: state.finishedAt, resolutionTimeMs: state.resolutionTimeMs, roundRank: state.roundRank,
            spectating: state.sittingOut || state.absent,
        };
    }
}
