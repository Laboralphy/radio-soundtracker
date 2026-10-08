import { describe, it, expect, afterEach } from 'vitest';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { VLCConnection, extractResponse } from '../src/libs/vlc-control/VLCConnection.js';

const BANNER = 'VLC media player 3.0.23 Vetinari\r\nCommand Line Interface initialized. Type `help\' for help.\r\n> ';

interface FakeVLC {
    port: number;
    close: () => Promise<void>;
}

/**
 * Starts a TCP server that behaves like the VLC RC interface:
 * banner, then one response and one prompt per command line.
 * The handler returns the response, or null to never answer.
 */
async function startFakeVLC(handler: (command: string, connection: number) => string | null): Promise<FakeVLC> {
    let connections = 0;
    const sockets = new Set<net.Socket>();
    const fake = { port: 0, close: async () => {} };
    const server = net.createServer(socket => {
        const connection = ++connections;
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.on('error', () => {});
        let buffer = '';
        socket.on('data', data => {
            buffer += data.toString();
            let index: number;
            while ((index = buffer.indexOf('\n')) >= 0) {
                const command = buffer.slice(0, index);
                buffer = buffer.slice(index + 1);
                const response = handler(command, connection);
                if (response === null) {
                    continue;
                }
                // split the answer in two writes, as TCP may do
                const text = (response === '' ? '' : response + '\r\n') + '> ';
                socket.write(text.slice(0, 2));
                setTimeout(() => socket.write(text.slice(2)), 5);
            }
        });
        socket.write(BANNER);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    fake.port = (server.address() as AddressInfo).port;
    fake.close = () => new Promise(resolve => {
        sockets.forEach(s => s.destroy());
        server.close(() => resolve());
    });
    return fake;
}

describe('extractResponse', () => {
    it('returns null while no prompt was received', () => {
        expect(extractResponse('12\r\n')).toBeNull();
    });
    it('returns the text before the prompt', () => {
        expect(extractResponse('12\r\n> ')).toBe('12');
    });
    it('returns an empty string for a command without output', () => {
        expect(extractResponse('> ')).toBe('');
    });
    it('keeps multi-line responses', () => {
        expect(extractResponse('( state playing )\r\n( audio volume: 0 )\r\n> ')).toBe('( state playing )\n( audio volume: 0 )');
    });
    it('ignores "> " in the middle of a line', () => {
        expect(extractResponse('a > ')).toBeNull();
    });
});

describe('VLCConnection', () => {
    let fake: FakeVLC | null = null;
    afterEach(async () => {
        await fake?.close();
        fake = null;
    });

    it('returns one response per command', async () => {
        fake = await startFakeVLC(c => ({ get_time: '3', get_length: '10', enqueue: '' } as Record<string, string>)[c.split(' ')[0]] ?? 'unknown');
        const connection = new VLCConnection({ host: '127.0.0.1', port: fake.port });
        expect(await connection.sendBatch(['get_time', 'get_length', 'enqueue /a b.mod', 'get_time'])).toEqual(['3', '10', '', '3']);
        expect(await connection.sendTransaction('get_length')).toBe('10');
    });

    it('rejects when VLC does not answer in time', async () => {
        fake = await startFakeVLC(() => null);
        const connection = new VLCConnection({ host: '127.0.0.1', port: fake.port, timeout: 100 });
        await expect(connection.sendTransaction('is_playing')).rejects.toThrow(/timeout/);
    });

    it('rejects when VLC is not running', async () => {
        fake = await startFakeVLC(() => '');
        const port = fake.port;
        await fake.close();
        fake = null;
        const connection = new VLCConnection({ host: '127.0.0.1', port });
        await expect(connection.sendTransaction('is_playing')).rejects.toThrow();
    });

    it('does not interleave concurrent batches', async () => {
        const log: number[] = [];
        fake = await startFakeVLC((command, connection) => {
            log.push(connection);
            return command;
        });
        const connection = new VLCConnection({ host: '127.0.0.1', port: fake.port });
        const results = await Promise.all(['a', 'b', 'c'].map(s => connection.sendBatch([s + '1', s + '2', s + '3'])));
        expect(results).toEqual([['a1', 'a2', 'a3'], ['b1', 'b2', 'b3'], ['c1', 'c2', 'c3']]);
        expect(log).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3]);
    });

    it('keeps working after a failed transaction', async () => {
        let answer = false;
        fake = await startFakeVLC(() => answer ? '1' : null);
        const connection = new VLCConnection({ host: '127.0.0.1', port: fake.port, timeout: 100 });
        await expect(connection.sendTransaction('is_playing')).rejects.toThrow();
        answer = true;
        expect(await connection.sendTransaction('is_playing')).toBe('1');
    });
});
