// Track data - Add your tracks here
// Each track needs: title, artist, genre, src (path to audio file), cover (path to cover image or null)
const tracks = [
    // Example tracks - replace with your actual tracks
    {
        title: "Demo Track 1",
        artist: "DS",
        genre: "electronic",
        src: "tracks/demo1.mp3",
        cover: null // Will use placeholder
    },
    {
        title: "Ambient Waves",
        artist: "DS",
        genre: "ambient",
        src: "tracks/ambient1.mp3",
        cover: null
    },
    {
        title: "Experimental Sound",
        artist: "DS",
        genre: "experimental",
        src: "tracks/exp1.mp3",
        cover: null
    }
];

// State
let currentTrackIndex = -1;
let wavesurfer = null;
let isPlaying = false;

// DOM Elements
const trackGrid = document.getElementById('track-grid');
const playerCover = document.getElementById('player-cover');
const playerTitle = document.getElementById('player-title');
const playerArtist = document.getElementById('player-artist');
const playPauseBtn = document.getElementById('play-pause-btn');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const currentTimeEl = document.getElementById('current-time');
const totalTimeEl = document.getElementById('total-time');
const volumeSlider = document.getElementById('volume-slider');
const filterBtns = document.querySelectorAll('.filter-btn');

// Initialize WaveSurfer
function initWaveSurfer() {
    wavesurfer = WaveSurfer.create({
        container: '#waveform',
        waveColor: '#4fc3f7',
        progressColor: '#bb9af7',
        cursorColor: 'hotpink',
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        height: 50,
        responsive: true,
        normalize: true
    });

    // Event listeners
    wavesurfer.on('ready', () => {
        totalTimeEl.textContent = formatTime(wavesurfer.getDuration());
        if (isPlaying) {
            wavesurfer.play();
        }
    });

    wavesurfer.on('audioprocess', () => {
        currentTimeEl.textContent = formatTime(wavesurfer.getCurrentTime());
    });

    wavesurfer.on('seeking', () => {
        currentTimeEl.textContent = formatTime(wavesurfer.getCurrentTime());
    });

    wavesurfer.on('finish', () => {
        playNext();
    });

    wavesurfer.on('play', () => {
        isPlaying = true;
        updatePlayPauseIcon();
    });

    wavesurfer.on('pause', () => {
        isPlaying = false;
        updatePlayPauseIcon();
    });
}

// Format time in MM:SS
function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Update play/pause button icon
function updatePlayPauseIcon() {
    const icon = playPauseBtn.querySelector('i');
    icon.className = isPlaying ? 'fas fa-pause' : 'fas fa-play';
}

// Render track cards
function renderTracks(filter = 'all') {
    trackGrid.innerHTML = '';

    const filteredTracks = filter === 'all'
        ? tracks
        : tracks.filter(track => track.genre === filter);

    if (filteredTracks.length === 0) {
        trackGrid.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1;">
                <i class="fas fa-music"></i>
                <h3>No tracks found</h3>
                <p>Add your audio files to the tracks folder and update the track data in music.js</p>
            </div>
        `;
        return;
    }

    filteredTracks.forEach((track, index) => {
        const originalIndex = tracks.indexOf(track);
        const card = document.createElement('div');
        card.className = `track-card${originalIndex === currentTrackIndex ? ' active' : ''}`;
        card.dataset.index = originalIndex;

        const coverHtml = track.cover
            ? `<img src="${track.cover}" alt="${track.title}" class="track-cover">`
            : `<div class="track-cover-placeholder"><i class="fas fa-music"></i></div>`;

        card.innerHTML = `
            ${coverHtml}
            <div class="track-overlay">
                <span class="play-icon"><i class="fas ${originalIndex === currentTrackIndex && isPlaying ? 'fa-pause' : 'fa-play'}"></i></span>
            </div>
            <div class="track-info">
                <div class="track-title">${track.title}</div>
                <div class="track-artist">${track.artist}</div>
                <span class="track-genre">${track.genre}</span>
            </div>
        `;

        card.addEventListener('click', () => {
            if (originalIndex === currentTrackIndex) {
                togglePlayPause();
            } else {
                loadTrack(originalIndex);
                isPlaying = true;
            }
        });

        trackGrid.appendChild(card);
    });
}

// Load a track
function loadTrack(index) {
    if (index < 0 || index >= tracks.length) return;

    currentTrackIndex = index;
    const track = tracks[index];

    // Update player info
    playerTitle.textContent = track.title;
    playerArtist.textContent = track.artist;

    // Update cover
    if (track.cover) {
        playerCover.innerHTML = `<img src="${track.cover}" alt="${track.title}" class="player-cover">`;
    } else {
        playerCover.innerHTML = `<div class="player-cover-placeholder"><i class="fas fa-music"></i></div>`;
    }

    // Load audio into wavesurfer
    wavesurfer.load(track.src);

    // Update active state on cards
    document.querySelectorAll('.track-card').forEach(card => {
        card.classList.toggle('active', parseInt(card.dataset.index) === index);
        const icon = card.querySelector('.play-icon i');
        if (parseInt(card.dataset.index) === index) {
            icon.className = isPlaying ? 'fas fa-pause' : 'fas fa-play';
        } else {
            icon.className = 'fas fa-play';
        }
    });
}

// Toggle play/pause
function togglePlayPause() {
    if (currentTrackIndex === -1 && tracks.length > 0) {
        loadTrack(0);
        isPlaying = true;
        return;
    }

    wavesurfer.playPause();

    // Update card icons
    document.querySelectorAll('.track-card').forEach(card => {
        if (parseInt(card.dataset.index) === currentTrackIndex) {
            const icon = card.querySelector('.play-icon i');
            icon.className = isPlaying ? 'fas fa-play' : 'fas fa-pause';
        }
    });
}

// Play previous track
function playPrev() {
    if (tracks.length === 0) return;
    const newIndex = currentTrackIndex <= 0 ? tracks.length - 1 : currentTrackIndex - 1;
    loadTrack(newIndex);
    isPlaying = true;
}

// Play next track
function playNext() {
    if (tracks.length === 0) return;
    const newIndex = currentTrackIndex >= tracks.length - 1 ? 0 : currentTrackIndex + 1;
    loadTrack(newIndex);
    isPlaying = true;
}

// Handle filter clicks
function handleFilter(e) {
    const genre = e.target.dataset.genre;
    filterBtns.forEach(btn => btn.classList.toggle('active', btn === e.target));
    renderTracks(genre);
}

// Handle volume change
function handleVolumeChange(e) {
    const volume = e.target.value / 100;
    if (wavesurfer) {
        wavesurfer.setVolume(volume);
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initWaveSurfer();
    renderTracks();

    // Event listeners
    playPauseBtn.addEventListener('click', togglePlayPause);
    prevBtn.addEventListener('click', playPrev);
    nextBtn.addEventListener('click', playNext);
    volumeSlider.addEventListener('input', handleVolumeChange);
    filterBtns.forEach(btn => btn.addEventListener('click', handleFilter));

    // Keyboard controls
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT') return;

        switch(e.code) {
            case 'Space':
                e.preventDefault();
                togglePlayPause();
                break;
            case 'ArrowLeft':
                playPrev();
                break;
            case 'ArrowRight':
                playNext();
                break;
        }
    });
});
