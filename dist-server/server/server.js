import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { Server } from 'socket.io';
import { ALPHABETS } from '../shared/game.js';
import { DEFAULT_VOLTES, SUPPORTED_VOLTES } from '../shared/protocol.js';
import { GameManager } from './game/GameManager.js';
const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const frontendDist = resolve(process.cwd(), 'dist');
const PUBLIC_SITE_ORIGIN = 'https://penjat.cat';
const mimeTypes = {
    '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.ico': 'image/x-icon',
    '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.webp': 'image/webp', '.woff': 'font/woff',
    '.woff2': 'font/woff2', '.xml': 'application/xml; charset=utf-8',
};
const routeMetadata = {
    '/': {
        title: 'Penjat — Joc del penjat online en català',
        description: 'Juga al Penjat online en català. Endevina paraules, juga amb amics i aprèn vocabulari català de manera divertida.',
        canonicalPath: '/',
    },
    '/multijugador/': {
        title: 'Penjat multijugador — Juga online amb amics',
        description: 'Juga a Penjat multijugador online amb amics. Crea una sala, comparteix el codi i competeix en català o castellà.',
        canonicalPath: '/multijugador',
    },
    '/aprendre/': {
        title: 'Aprèn vocabulari català jugant al penjat | Penjat',
        description: 'Aprèn vocabulari català jugant al penjat. Paraules per temes (natura, animals, menjar, casa, ciutat, emocions) amb definicions, exemples i traducció al castellà.',
        canonicalPath: '/aprendre',
    },
    '/paraula-del-dia/': {
        title: 'El penjat del dia: endevina una paraula en català | Penjat',
        description: 'Juga al penjat del dia en català. Cada dia hi ha una nova paraula, la mateixa per a tothom. Endevina-la i comparteix el resultat.',
        canonicalPath: '/paraula-del-dia',
        socialTitle: 'Paraula del dia | Penjat',
        socialDescription: 'Endevina la paraula catalana del dia jugant al Penjat i comparteix el resultat sense revelar-la.',
    },
    '/com-es-juga/': {
        title: 'Com es juga a Penjat? | Penjat',
        description: 'Descobreix com es juga a Penjat, tant en multijugador com en mode d’aprenentatge de vocabulari.',
        canonicalPath: '/com-es-juga',
    },
};
const httpServer = createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://localhost');
    if (url.pathname.startsWith('/socket.io/'))
        return;
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const previewMatch = /^\/api\/rooms\/([A-Z2-9]{5})\/preview$/i.exec(url.pathname);
    if (previewMatch) {
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        if (!['GET', 'HEAD'].includes(request.method || 'GET')) {
            response.writeHead(405, { Allow: 'GET, HEAD' });
            response.end(request.method === 'HEAD' ? undefined : JSON.stringify({ ok: false, error: 'method-not-allowed' }));
            return;
        }
        const result = roomPreview(previewMatch[1]);
        response.writeHead(result.ok ? 200 : result.error === 'room-full' ? 409 : 404);
        response.end(request.method === 'HEAD' ? undefined : JSON.stringify(result));
        return;
    }
    if (url.pathname === '/health') {
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ ok: true }));
        return;
    }
    if (!['GET', 'HEAD'].includes(request.method || 'GET')) {
        response.writeHead(405, { Allow: 'GET, HEAD' });
        response.end();
        return;
    }
    if (url.pathname === '/es' || url.pathname.startsWith('/es/')) {
        const trimmedPath = url.pathname.replace(/\/+$/, '');
        const canonicalPath = trimmedPath === '/es'
            ? '/'
            : trimmedPath === '/es/como-jugar'
                ? '/com-es-juga/'
                : `${trimmedPath.slice(3)}/`;
        response.writeHead(308, { Location: `${canonicalPath}${url.search}` });
        response.end();
        return;
    }
    try {
        const requestedPath = decodeURIComponent(url.pathname);
        let filePath = resolve(frontendDist, `.${requestedPath === '/' ? '/index.html' : requestedPath}`);
        if (filePath !== frontendDist && !filePath.startsWith(`${frontendDist}${sep}`))
            throw new Error('Invalid path');
        const fileStats = await stat(filePath).catch(() => null);
        if (!fileStats?.isFile())
            filePath = resolve(frontendDist, 'index.html');
        const body = await readFile(filePath);
        const isAsset = filePath.includes(`${sep}assets${sep}`);
        const routeKey = normalizeMetadataRoute(url.pathname);
        const responseBody = extname(filePath).toLowerCase() === '.html' && routeMetadata[routeKey]
            ? applyRouteMetadata(body.toString('utf8'), routeMetadata[routeKey])
            : body;
        response.writeHead(200, {
            'Content-Type': mimeTypes[extname(filePath).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
        });
        response.end(request.method === 'HEAD' ? undefined : responseBody);
    }
    catch {
        response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Frontend build unavailable. Run npm run build before starting the server.');
    }
});
const localDevelopmentOrigins = [/^http:\/\/(localhost|127\.0\.0\.1):\d+$/];
const allowedOrigins = CLIENT_ORIGIN || (IS_PRODUCTION ? undefined : localDevelopmentOrigins);
const io = new Server(httpServer, {
    ...(allowedOrigins ? { cors: { origin: allowedOrigins } } : {}),
});
const broadcastRoom = (code) => {
    const room = games.rooms.get(code);
    if (!room)
        return;
    for (const player of room.players)
        if (player.socketId)
            io.to(player.socketId).emit('room:state', room.viewFor(player.id));
};
const games = new GameManager(process.env.DETERMINISTIC_FIRST_SETTER === '1' ? () => 0 : Math.random, {
    onRoomChange: (code) => { console.info('player away after grace period', { roomCode: code }); broadcastRoom(code); },
    onRoomExpired: (code) => console.info('empty room expired', { roomCode: code }),
});
const cleanName = (value) => typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 24 ? value.trim() : null;
const cleanVoltes = (value) => SUPPORTED_VOLTES.includes(value) ? value : undefined;
const cleanLanguage = (value) => typeof value === 'string' && Object.hasOwn(ALPHABETS, value) ? value : undefined;
/** Omitted settings keep `fallback`; a present but unsupported value rejects the whole request. */
function cleanSettings(payload, fallback) {
    const raw = (payload ?? {});
    const language = raw.gameLanguage === undefined ? fallback.language : cleanLanguage(raw.gameLanguage);
    const voltes = raw.voltes === undefined ? fallback.voltes : cleanVoltes(raw.voltes);
    if ((raw.gameLanguage !== undefined && !language) || (raw.voltes !== undefined && !voltes))
        return null;
    return { language, voltes };
}
const roomPreview = (rawCode) => {
    const code = rawCode.trim().toUpperCase();
    const room = games.rooms.get(code);
    if (!room)
        return { ok: false, error: 'room-not-found' };
    if (!room.acceptingPlayers)
        return { ok: false, error: 'room-full' };
    return { ok: true, data: { code: room.code, gameLanguage: room.language, voltes: room.voltes, players: room.activePlayers.length, acceptingPlayers: room.acceptingPlayers } };
};
io.on('connection', (socket) => {
    console.info('socket connected', { socketId: socket.id });
    const broadcast = broadcastRoom;
    const action = (ack, operation) => {
        try {
            operation();
            ack({ ok: true, data: undefined });
        }
        catch (error) {
            ack({ ok: false, error: error instanceof Error ? error.message : 'unknown-error' });
        }
    };
    socket.on('room:create', (payload, ack) => {
        const name = cleanName(payload?.name);
        const settings = cleanSettings(payload, { language: 'ca', voltes: DEFAULT_VOLTES });
        if (!name || !settings)
            return ack({ ok: false, error: 'invalid-details' });
        const { room, playerId, reconnectToken } = games.create(socket.id, name, settings.language, settings.voltes);
        socket.join(room.code);
        ack({ ok: true, data: { view: room.viewFor(playerId), session: { roomCode: room.code, playerId, reconnectToken } } });
        socket.emit('chat:history', room.chatHistory);
        console.info('player created room', { roomCode: room.code, playerId, socketId: socket.id });
    });
    socket.on('room:join', (payload, ack) => {
        const name = cleanName(payload?.name);
        if (!name || typeof payload?.code !== 'string')
            return ack({ ok: false, error: 'invalid-details' });
        try {
            const { room, playerId, reconnectToken } = games.join(socket.id, name, payload.code);
            socket.join(room.code);
            ack({ ok: true, data: { view: room.viewFor(playerId), session: { roomCode: room.code, playerId, reconnectToken } } });
            socket.emit('chat:history', room.chatHistory);
            broadcast(room.code);
            console.info('player joined room', { roomCode: room.code, playerId, socketId: socket.id });
        }
        catch (error) {
            ack({ ok: false, error: error instanceof Error ? error.message : 'unknown-error' });
        }
    });
    socket.on('room:resume', (payload, ack) => {
        const roomCode = typeof payload?.roomCode === 'string' ? payload.roomCode.trim().toUpperCase() : '';
        const playerId = typeof payload?.playerId === 'string' ? payload.playerId : '';
        console.info('resume attempt', { roomCode, playerId, socketId: socket.id });
        try {
            const previousSocketId = games.rooms.get(roomCode)?.player(playerId)?.socketId;
            const room = games.resume(socket.id, roomCode, playerId, payload?.reconnectToken);
            // Another tab or device that still held this player stops receiving the room and is told why.
            if (previousSocketId && previousSocketId !== socket.id) {
                io.in(previousSocketId).socketsLeave(room.code);
                io.to(previousSocketId).emit('room:replaced');
            }
            socket.join(room.code);
            ack({ ok: true, data: room.viewFor(playerId) });
            socket.emit('chat:history', room.chatHistory);
            broadcast(room.code);
            console.info('resume successful', { roomCode: room.code, playerId, socketId: socket.id });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'resume-rejected';
            ack({ ok: false, error: message });
            console.info('resume rejected', { roomCode, playerId, socketId: socket.id, reason: message });
        }
    });
    socket.on('room:continue-without', (payload, ack) => action(ack, () => {
        if (typeof payload?.playerId !== 'string')
            throw new Error('invalid-skip');
        const room = games.continueWithout(socket.id, payload.playerId);
        console.info('continued without player', { roomCode: room.code, playerId: payload.playerId });
        broadcast(room.code);
    }));
    socket.on('room:update-settings', (payload, ack) => action(ack, () => {
        const identity = games.identityForSocket(socket.id), room = identity?.room;
        if (!room)
            throw new Error('room-not-found');
        const settings = cleanSettings(payload, {});
        if (!settings || (!settings.language && !settings.voltes))
            throw new Error('invalid-settings');
        room.updateSettings(identity.playerId, settings);
        broadcast(room.code);
    }));
    socket.on('room:start', (ack) => action(ack, () => {
        const identity = games.identityForSocket(socket.id), room = identity?.room;
        if (!room)
            throw new Error('room-not-found');
        room.start(identity.playerId);
        broadcast(room.code);
    }));
    socket.on('round:set-word', (payload, ack) => action(ack, () => {
        const identity = games.identityForSocket(socket.id), room = identity?.room;
        if (!room)
            throw new Error('room-not-found');
        room.setWord(identity.playerId, payload?.word);
        broadcast(room.code);
    }));
    socket.on('game:guess', (payload, ack) => action(ack, () => {
        const identity = games.identityForSocket(socket.id), room = identity?.room;
        if (!room)
            throw new Error('room-not-found');
        room.guess(identity.playerId, payload?.letter);
        broadcast(room.code);
    }));
    socket.on('round:forgiveness', (payload, ack) => action(ack, () => {
        const identity = games.identityForSocket(socket.id), room = identity?.room;
        if (!room)
            throw new Error('room-not-found');
        room.decideForgiveness(identity.playerId, payload?.requestId, payload?.forgive);
        broadcast(room.code);
    }));
    socket.on('round:observe-player', (payload, ack) => action(ack, () => {
        const identity = games.identityForSocket(socket.id), room = identity?.room;
        if (!room)
            throw new Error('room-not-found');
        if (typeof payload?.playerId !== 'string')
            throw new Error('invalid-observed-player');
        room.observePlayer(identity.playerId, payload.playerId);
        broadcast(room.code);
    }));
    socket.on('round:continue', (ack) => action(ack, () => {
        const identity = games.identityForSocket(socket.id), room = identity?.room;
        if (!room)
            throw new Error('room-not-found');
        room.continue(identity.playerId);
        broadcast(room.code);
    }));
    socket.on('match:rematch', (ack) => action(ack, () => {
        const identity = games.identityForSocket(socket.id), room = identity?.room;
        if (!room)
            throw new Error('room-not-found');
        room.requestRematch(identity.playerId);
        broadcast(room.code);
    }));
    socket.on('chat:typing', (payload) => {
        const identity = games.identityForSocket(socket.id), player = identity?.room.player(identity.playerId);
        if (!identity || !player || typeof payload?.isTyping !== 'boolean')
            return;
        socket.to(identity.room.code).emit('chat:typing', { playerId: player.id, playerName: player.name, isTyping: payload.isTyping });
    });
    socket.on('chat:send', (payload, ack) => {
        try {
            const identity = games.identityForSocket(socket.id), room = identity?.room;
            if (!room)
                throw new Error('not-room-member');
            const message = room.addChatMessage(identity.playerId, payload?.text);
            io.to(room.code).emit('chat:message', message);
            ack({ ok: true, data: message });
        }
        catch (error) {
            ack({ ok: false, error: error instanceof Error ? error.message : 'invalid-chat-message' });
        }
    });
    socket.on('chat:react', (payload, ack) => {
        try {
            const identity = games.identityForSocket(socket.id), room = identity?.room;
            if (!room)
                throw new Error('not-room-member');
            const update = room.toggleChatReaction(identity.playerId, payload?.messageId, payload?.reaction);
            io.to(room.code).emit('chat:reaction-updated', update);
            ack({ ok: true, data: update.reactions });
        }
        catch (error) {
            ack({ ok: false, error: error instanceof Error ? error.message : 'invalid-reaction' });
        }
    });
    socket.on('room:leave', () => {
        const identity = games.identityForSocket(socket.id);
        if (!identity)
            return;
        socket.to(identity.room.code).emit('chat:typing', { playerId: identity.playerId, playerName: identity.room.player(identity.playerId)?.name ?? '', isTyping: false });
        const room = games.leaveSocket(socket.id);
        socket.leave(identity.room.code);
        if (room)
            broadcast(room.code);
    });
    socket.on('disconnect', (reason) => {
        console.info('socket disconnected', { socketId: socket.id, reason });
        const identity = games.markReconnecting(socket.id);
        if (!identity)
            return;
        const { room, playerId } = identity;
        socket.to(room.code).emit('chat:typing', { playerId, playerName: room.player(playerId)?.name ?? '', isTyping: false });
        broadcast(room.code);
        console.info('player marked reconnecting', { roomCode: room.code, playerId });
    });
});
httpServer.listen(PORT, HOST, () => console.log(`Hangman server listening on http://${HOST}:${PORT}`));
export { httpServer, games };
function normalizeMetadataRoute(pathname) {
    const trimmed = pathname.replace(/\/+$/, '') || '/';
    return trimmed === '/' ? '/' : `${trimmed}/`;
}
function applyRouteMetadata(html, metadata) {
    const canonical = new URL(metadata.canonicalPath, PUBLIC_SITE_ORIGIN).href;
    const socialTitle = metadata.socialTitle ?? metadata.title;
    const socialDescription = metadata.socialDescription ?? metadata.description;
    return html
        .replace(/<title>.*?<\/title>/, `<title>${escapeHtml(metadata.title)}</title>`)
        .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${escapeHtml(metadata.description)}" />`)
        .replace(/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${canonical}" />`)
        .replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${escapeHtml(socialTitle)}" />`)
        .replace(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${escapeHtml(socialDescription)}" />`)
        .replace(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${canonical}" />`)
        .replace(/<meta name="twitter:title" content="[^"]*" \/>/, `<meta name="twitter:title" content="${escapeHtml(socialTitle)}" />`)
        .replace(/<meta name="twitter:description" content="[^"]*" \/>/, `<meta name="twitter:description" content="${escapeHtml(socialDescription)}" />`);
}
function escapeHtml(value) {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}
