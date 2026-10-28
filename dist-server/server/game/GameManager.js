import { GameRoom } from './GameRoom.js';
import { randomInt, randomUUID } from 'node:crypto';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** A lost connection freezes the player's part of the game this long; then they are away (seat kept, game moves on). */
export const ABSENCE_GRACE_MS = 2 * 60_000;
/** A room with nobody connected is deleted after this long, together with every retained seat. */
export const EMPTY_ROOM_TTL_MS = 30 * 60_000;
export class GameManager {
    random;
    options;
    rooms = new Map();
    playerRooms = new Map();
    socketPlayers = new Map();
    absenceTimers = new Map();
    expiryTimers = new Map();
    absenceGraceMs;
    emptyRoomTtlMs;
    scheduler;
    constructor(random = Math.random, options = {}) {
        this.random = random;
        this.options = options;
        this.absenceGraceMs = options.absenceGraceMs ?? ABSENCE_GRACE_MS;
        this.emptyRoomTtlMs = options.emptyRoomTtlMs ?? EMPTY_ROOM_TTL_MS;
        // Unreferenced: room timers never keep a finished process (or a test) alive; the HTTP server does that.
        this.scheduler = options.scheduler ?? { setTimeout: (callback, ms) => setTimeout(callback, ms).unref(), clearTimeout: (timer) => clearTimeout(timer) };
    }
    create(socketId, name, language, voltes) {
        let code = this.code();
        while (this.rooms.has(code))
            code = this.code();
        const room = new GameRoom(code, language, voltes, this.random);
        const playerId = randomUUID(), reconnectToken = randomUUID();
        room.addPlayer(playerId, socketId, reconnectToken, name);
        this.rooms.set(code, room);
        this.playerRooms.set(playerId, code);
        this.socketPlayers.set(socketId, playerId);
        return { room, playerId, reconnectToken };
    }
    join(socketId, name, rawCode) {
        const code = rawCode.trim().toUpperCase();
        const room = this.rooms.get(code);
        if (!room)
            throw new Error('room-not-found');
        const playerId = randomUUID(), reconnectToken = randomUUID();
        room.addPlayer(playerId, socketId, reconnectToken, name);
        this.playerRooms.set(playerId, code);
        this.socketPlayers.set(socketId, playerId);
        this.cancelExpiry(code);
        return { room, playerId, reconnectToken };
    }
    roomForPlayer(playerId) {
        const code = this.playerRooms.get(playerId);
        return code ? this.rooms.get(code) : undefined;
    }
    identityForSocket(socketId) {
        const playerId = this.socketPlayers.get(socketId);
        const room = playerId ? this.roomForPlayer(playerId) : undefined;
        return playerId && room ? { playerId, room } : undefined;
    }
    resume(socketId, code, playerId, token) {
        const room = this.rooms.get(code.trim().toUpperCase());
        if (!room || this.playerRooms.get(playerId) !== room.code)
            throw new Error('room-not-found');
        const previousSocketId = room.player(playerId)?.socketId;
        room.resume(playerId, token, socketId);
        if (previousSocketId && previousSocketId !== socketId)
            this.socketPlayers.delete(previousSocketId);
        this.socketPlayers.set(socketId, playerId);
        this.cancelAbsence(playerId);
        this.cancelExpiry(room.code);
        return room;
    }
    /** Explicit leave by credentials rather than by connection; returns the socket that held the seat, if any. */
    abandon(code, playerId, token) {
        const room = this.rooms.get(code.trim().toUpperCase());
        if (!room || this.playerRooms.get(playerId) !== room.code)
            throw new Error('room-not-found');
        const player = room.player(playerId);
        if (!player || !player.active || player.reconnectToken !== token)
            throw new Error('resume-rejected');
        const previousSocketId = player.socketId && this.socketPlayers.get(player.socketId) === playerId ? player.socketId : undefined;
        this.removePlayer(playerId, previousSocketId);
        return { room, previousSocketId, deleted: this.rooms.get(room.code) !== room };
    }
    /** The socket closed without leaving: the seat is kept; after the grace period the game stops waiting for it. */
    markReconnecting(socketId) {
        const identity = this.identityForSocket(socketId);
        this.socketPlayers.delete(socketId);
        if (!identity || !identity.room.markReconnecting(identity.playerId, socketId))
            return undefined;
        const { room, playerId } = identity;
        this.cancelAbsence(playerId);
        this.absenceTimers.set(playerId, this.scheduler.setTimeout(() => {
            this.absenceTimers.delete(playerId);
            if (this.rooms.get(room.code) === room && room.markAway(playerId))
                this.options.onRoomChange?.(room.code);
        }, this.absenceGraceMs));
        this.scheduleExpiryIfEmpty(room);
        return identity;
    }
    leaveSocket(socketId) {
        const identity = this.identityForSocket(socketId);
        if (!identity)
            return undefined;
        return this.removePlayer(identity.playerId, socketId);
    }
    /** A connected member continues without a blocking reconnecting player: the away handling applies now. */
    continueWithout(socketId, targetId) {
        const identity = this.identityForSocket(socketId);
        if (!identity)
            throw new Error('room-not-found');
        const changed = identity.room.continueWithout(identity.playerId, targetId);
        if (changed)
            this.cancelAbsence(targetId);
        return identity.room;
    }
    /** Explicit leave: the seat is given up; the last member leaving deletes the room at once. */
    removePlayer(playerId, socketId) {
        const room = this.roomForPlayer(playerId);
        if (!room)
            return undefined;
        room.disconnect(playerId);
        this.playerRooms.delete(playerId);
        this.cancelAbsence(playerId);
        if (socketId)
            this.socketPlayers.delete(socketId);
        if (!room.activePlayers.length)
            this.deleteRoom(room.code);
        else
            this.scheduleExpiryIfEmpty(room);
        return room;
    }
    scheduleExpiryIfEmpty(room) {
        if (room.connectedPlayers.length || this.expiryTimers.has(room.code))
            return;
        this.expiryTimers.set(room.code, this.scheduler.setTimeout(() => {
            this.expiryTimers.delete(room.code);
            if (this.rooms.get(room.code) !== room || room.connectedPlayers.length)
                return;
            this.deleteRoom(room.code);
            this.options.onRoomExpired?.(room.code);
        }, this.emptyRoomTtlMs));
    }
    deleteRoom(code) {
        const room = this.rooms.get(code);
        this.cancelExpiry(code);
        this.rooms.delete(code);
        for (const player of room?.players ?? []) {
            this.cancelAbsence(player.id);
            if (this.playerRooms.get(player.id) === code)
                this.playerRooms.delete(player.id);
            if (player.socketId && this.socketPlayers.get(player.socketId) === player.id)
                this.socketPlayers.delete(player.socketId);
        }
    }
    cancelAbsence(playerId) {
        const timer = this.absenceTimers.get(playerId);
        if (timer !== undefined)
            this.scheduler.clearTimeout(timer);
        this.absenceTimers.delete(playerId);
    }
    cancelExpiry(code) {
        const timer = this.expiryTimers.get(code);
        if (timer !== undefined)
            this.scheduler.clearTimeout(timer);
        this.expiryTimers.delete(code);
    }
    code() {
        return Array.from({ length: 5 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
    }
}
