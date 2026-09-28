"""Música a 120 BPM + efectos, sincronizados con events.json (lo exporta la escena).

Uso: python3 audio.py events.json out.wav DURACION
"""
import json, sys
import numpy as np

SR = 48000
events = json.load(open(sys.argv[1]))
out = sys.argv[2]
DUR = float(sys.argv[3])
N = int(SR * DUR)
BEAT = 0.5  # 120 BPM
rng = np.random.default_rng(7)

L = np.zeros(N); R = np.zeros(N)


def add(sig, t, gain=1.0, pan=0.0):
    i = int(t * SR)
    if i >= N:
        return
    sig = sig[: N - i]
    l = np.cos((pan + 1) * np.pi / 4); r = np.sin((pan + 1) * np.pi / 4)
    L[i:i + len(sig)] += sig * gain * l * 1.41
    R[i:i + len(sig)] += sig * gain * r * 1.41


def env(n, a=0.005, d=None, curve=6.0):
    t = np.arange(n) / SR
    e = np.minimum(1, t / max(a, 1e-4))
    total = n / SR
    e *= np.exp(-curve * np.maximum(0, t - a) / max(total, 1e-3))
    return e


def note(f, dur, kind='pluck'):
    n = int(dur * SR); t = np.arange(n) / SR
    if kind == 'pluck':
        s = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(4 * np.pi * f * t) + 0.12 * np.sin(6 * np.pi * f * t)
        return s * env(n, 0.004, curve=7)
    if kind == 'pad':
        s = sum(np.sin(2 * np.pi * f * (1 + dt) * t + p) for dt, p in ((0, 0), (0.004, 1), (-0.0035, 2)))
        a = np.minimum(1, t / 0.6) * np.minimum(1, (dur - t) / 0.6)
        return s / 3 * np.clip(a, 0, 1)
    if kind == 'bass':
        s = np.sin(2 * np.pi * f * t) + 0.2 * np.sin(4 * np.pi * f * t)
        return s * env(n, 0.01, curve=4)


def m2f(m):
    return 440 * 2 ** ((m - 69) / 12)


# Progresión luminosa: Fmaj7 – Am7 – Dm9 – Bbmaj7 (1 compás = 4 tiempos = 2 s)
chords = [[53, 57, 60, 64], [57, 60, 64, 67], [50, 57, 60, 64], [46, 53, 57, 62]]
MUSIC_IN = 1.0   # entra con la luz del intro
MUSIC_OUT = DUR

bar = 0
t = 0.0
while t < DUR:
    ch = chords[bar % 4]
    lvl = 1.0 if t >= MUSIC_IN else 0.0
    if lvl:
        # pad
        for m in ch:
            add(note(m2f(m + 12), 2.05, 'pad'), t, 0.028)
        # bajo en 1 y 3
        add(note(m2f(ch[0] - 12), 0.9, 'bass'), t, 0.16)
        add(note(m2f(ch[0] - 12), 0.9, 'bass'), t + 1.0, 0.12)
    # arpegio en corcheas a partir del compás 3 (t >= 5 s)
    if t >= 5.0:
        pat = [0, 2, 1, 3, 2, 1, 3, 2]
        for k in range(8):
            m = ch[pat[k]] + 24
            add(note(m2f(m), 0.35, 'pluck'), t + k * 0.25, 0.045, pan=(-0.4 if k % 2 else 0.4))
    # percusión suave a partir de t >= 8
    if t >= 8.0 and t < DUR - 3.0:
        for k in range(4):
            tb = t + k * BEAT
            # kick blando
            n = int(0.25 * SR); tt = np.arange(n) / SR
            kick = np.sin(2 * np.pi * (48 + 60 * np.exp(-tt * 30)) * tt) * np.exp(-tt * 14)
            add(kick, tb, 0.22 if k % 2 == 0 else 0.12)
            # hat en contratiempo
            n = int(0.05 * SR)
            hat = rng.standard_normal(n); hat = np.diff(np.concatenate([[0], hat])) * np.exp(-np.arange(n) / SR * 90)
            add(hat, tb + 0.25, 0.018, pan=0.3)
    t += 2.0; bar += 1

# Final: acorde largo que se apaga con el video
for m in [53, 57, 60, 64, 69]:
    add(note(m2f(m + 12), 3.2, 'pad'), DUR - 3.0, 0.035)


# ── efectos ──
def sfx_click():
    n = int(0.03 * SR); tt = np.arange(n) / SR
    s = rng.standard_normal(n) * np.exp(-tt * 400) * 0.6 + np.sin(2 * np.pi * 2400 * tt) * np.exp(-tt * 300) * 0.5
    n2 = int(0.03 * SR)
    s2 = np.sin(2 * np.pi * 1500 * tt[:n2]) * np.exp(-tt[:n2] * 350) * 0.3
    return np.concatenate([s, np.zeros(int(0.045 * SR))]) + np.concatenate([np.zeros(int(0.045 * SR)), s2])


def sfx_key():
    n = int(0.025 * SR); tt = np.arange(n) / SR
    f = rng.uniform(1800, 3200)
    return (rng.standard_normal(n) * 0.5 + np.sin(2 * np.pi * f * tt)) * np.exp(-tt * 380)


def sfx_tick():
    n = int(0.12 * SR); tt = np.arange(n) / SR
    return (np.sin(2 * np.pi * 1760 * tt) + 0.4 * np.sin(2 * np.pi * 2640 * tt)) * np.exp(-tt * 38)


def sfx_whoosh(d=0.6):
    n = int(d * SR); tt = np.arange(n) / SR
    s = rng.standard_normal(n)
    # filtro pasa bajos móvil (one-pole) para un soplo suave
    out = np.zeros(n); y = 0
    cut = 0.02 + 0.10 * np.sin(np.pi * tt / d)
    for i in range(n):
        y += cut[i] * (s[i] - y); out[i] = y
    return out * np.sin(np.pi * tt / d) ** 2 * 2.2


def sfx_pop():
    n = int(0.18 * SR); tt = np.arange(n) / SR
    return np.sin(2 * np.pi * (660 + 440 * tt / 0.18) * tt) * np.exp(-tt * 22)


W = sfx_whoosh()
for e in events:
    t = e['t']; k = e['k']
    if k == 'click':
        add(sfx_click(), t, 0.28)
    elif k == 'key':
        add(sfx_key(), t, 0.10, pan=rng.uniform(-0.2, 0.2))
    elif k == 'pen':
        add(sfx_key(), t, 0.035, pan=0.1)
    elif k == 'tick':
        add(sfx_tick(), t, 0.10)
    elif k == 'whoosh':
        add(W, t - 0.2, 0.10)
    elif k == 'pop':
        add(sfx_pop(), t, 0.07)

# fades
fade_in = np.clip(np.arange(N) / SR / 0.8, 0, 1)
fade_out = np.clip((DUR - np.arange(N) / SR) / 1.2, 0, 1)
g = fade_in * fade_out
L *= g; R *= g
peak = max(np.abs(L).max(), np.abs(R).max())
L /= peak / 0.89; R /= peak / 0.89
stereo = (np.stack([L, R], 1) * 32767).astype('<i2')

import wave
w = wave.open(out, 'wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
w.writeframes(stereo.tobytes()); w.close()
print('ok', out, DUR)
