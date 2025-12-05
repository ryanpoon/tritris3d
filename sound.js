class TritrisSound {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.6;
        this.master.connect(this.ctx.destination);

        this.sounds = {};
        this.loadAll();
    }

    load(name, url, volume = 1.0) {
        return fetch(url)
            .then(r => r.arrayBuffer())
            .then(b => this.ctx.decodeAudioData(b))
            .then(buf => {
                this.sounds[name] = { buffer: buf, volume: volume };
            });
    }

    loadAll() {
        this.load("move",      "sfx/move.wav", 0.9);
        this.load("rotate",    "sfx/rotate.wav", 0.3);
        this.load("lock",      "sfx/lock.wav", 0.8);
        this.load("lineclear", "sfx/lineclear.wav", 1.0);
        this.load("lightshow", "sfx/lightshow.wav", 1.2);
        // this.load("ambient",   "sfx/ambient_loop.wav", 0.25);
    }

    play(name, detune = 0) {
        const data = this.sounds[name];
        if (!data) return;

        const src = this.ctx.createBufferSource();
        src.buffer = data.buffer;
        src.detune.value = detune;

        const gain = this.ctx.createGain();
        gain.gain.value = data.volume;

        src.connect(gain).connect(this.master);
        src.start(0);
    }

    loop(name) {
        const data = this.sounds[name];
        if (!data) return;

        const src = this.ctx.createBufferSource();
        src.buffer = data.buffer;
        src.loop = true;

        const gain = this.ctx.createGain();
        gain.gain.value = data.volume;

        src.connect(gain).connect(this.master);
        src.start(0);

        this.loopNode = src;
    }
}

let sfx = null;

function initSound() {
    sfx = new TritrisSound();
}
