// Track data - Add your tracks here
const tracks = [
    {
        title: "Demo Track 1",
        artist: "DS",
        genre: "electronic",
        album: "Experiments Vol. 1",
        src: "tracks/demo1.mp3",
        cover: null,
        duration: "3:24"
    },
    {
        title: "Ambient Waves",
        artist: "DS",
        genre: "ambient",
        album: "Ambient Collection",
        src: "tracks/ambient1.mp3",
        cover: null,
        duration: "4:12"
    },
    {
        title: "Experimental Sound",
        artist: "DS",
        genre: "experimental",
        album: "Sound Lab",
        src: "tracks/exp1.mp3",
        cover: null,
        duration: "2:58"
    }
];

// State
let currentTrackIndex = -1;
let wavesurfer = null;
let isPlaying = false;
let isShuffleOn = false;
let isRepeatOn = false;
let shuffledIndices = [];

// DOM Elements
const albumGrid = document.getElementById('album-grid');
const playerCover = document.getElementById('player-cover');
const playerTitle = document.getElementById('player-title');
const playerArtist = document.getElementById('player-artist');
const playPauseBtn = document.getElementById('play-pause-btn');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const currentTimeEl = document.getElementById('current-time');
const totalTimeEl = document.getElementById('total-time');
const volumeSlider = document.getElementById('volume-slider');
const volumeBar = document.getElementById('volume-bar');
const volumeBtn = document.getElementById('volume-btn');
const filterPills = document.querySelectorAll('.filter-pill');
const mainPlayBtn = document.getElementById('main-play-btn');
const shuffleBtn = document.getElementById('shuffle-btn');
const shuffleToggle = document.getElementById('shuffle-toggle');
const repeatBtn = document.getElementById('repeat-btn');
const trackCountEl = document.getElementById('track-count');

// Sidebar playlist clicks
const playlistItems = document.querySelectorAll('.playlist-item');

// Initialize WaveSurfer
function initWaveSurfer() {
    wavesurfer = WaveSurfer.create({
        container: '#waveform',
        waveColor: 'rgba(255, 255, 255, 0.3)',
        progressColor: '#1DB954',
        cursorColor: 'transparent',
        barWidth: 2,
        barGap: 2,
        barRadius: 2,
        height: 40,
        responsive: true,
        normalize: true
    });

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
        if (isRepeatOn) {
            wavesurfer.seekTo(0);
            wavesurfer.play();
        } else {
            playNext();
        }
    });

    wavesurfer.on('play', () => {
        isPlaying = true;
        updatePlayPauseIcon();
        updateCardStates();
    });

    wavesurfer.on('pause', () => {
        isPlaying = false;
        updatePlayPauseIcon();
        updateCardStates();
    });
}

// Format time in MM:SS
function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Update play/pause button icons
function updatePlayPauseIcon() {
    // Bottom player
    const icon = playPauseBtn.querySelector('i');
    icon.className = isPlaying ? 'fas fa-pause' : 'fas fa-play';
    playPauseBtn.classList.toggle('paused', !isPlaying);

    // Main play button
    const mainIcon = mainPlayBtn.querySelector('i');
    mainIcon.className = isPlaying ? 'fas fa-pause' : 'fas fa-play';
}

// Update card states
function updateCardStates() {
    document.querySelectorAll('.album-card').forEach(card => {
        const index = parseInt(card.dataset.index);
        const isCurrentTrack = index === currentTrackIndex;
        card.classList.toggle('playing', isCurrentTrack && isPlaying);

        const playBtn = card.querySelector('.album-play-btn i');
        if (isCurrentTrack) {
            playBtn.className = isPlaying ? 'fas fa-pause' : 'fas fa-play';
        } else {
            playBtn.className = 'fas fa-play';
        }
    });
}

// Generate shuffle order
function generateShuffleOrder() {
    shuffledIndices = [...Array(tracks.length).keys()];
    for (let i = shuffledIndices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledIndices[i], shuffledIndices[j]] = [shuffledIndices[j], shuffledIndices[i]];
    }
}

// Get next track index
function getNextIndex() {
    if (isShuffleOn) {
        const currentShufflePos = shuffledIndices.indexOf(currentTrackIndex);
        const nextPos = (currentShufflePos + 1) % shuffledIndices.length;
        return shuffledIndices[nextPos];
    }
    return (currentTrackIndex + 1) % tracks.length;
}

// Get previous track index
function getPrevIndex() {
    if (isShuffleOn) {
        const currentShufflePos = shuffledIndices.indexOf(currentTrackIndex);
        const prevPos = (currentShufflePos - 1 + shuffledIndices.length) % shuffledIndices.length;
        return shuffledIndices[prevPos];
    }
    return (currentTrackIndex - 1 + tracks.length) % tracks.length;
}

// Render album cards
function renderTracks(filter = 'all') {
    albumGrid.innerHTML = '';

    const filteredTracks = filter === 'all'
        ? tracks
        : tracks.filter(track => track.genre === filter);

    if (filteredTracks.length === 0) {
        albumGrid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--spotify-text-muted);">
                <i class="fas fa-music" style="font-size: 4rem; margin-bottom: 20px; opacity: 0.5;"></i>
                <h3 style="font-size: 1.5rem; margin-bottom: 10px; color: var(--spotify-text);">No tracks found</h3>
                <p>Add your audio files to the tracks folder and update the track data in music.js</p>
            </div>
        `;
        return;
    }

    filteredTracks.forEach((track) => {
        const originalIndex = tracks.indexOf(track);
        const card = document.createElement('div');
        card.className = `album-card${originalIndex === currentTrackIndex ? ' playing' : ''}`;
        card.dataset.index = originalIndex;

        const coverHtml = track.cover
            ? `<img src="${track.cover}" alt="${track.title}" class="album-cover">`
            : `<div class="album-cover-placeholder"><i class="fas fa-music"></i></div>`;

        card.innerHTML = `
            <div class="album-cover-wrapper">
                ${coverHtml}
                <button class="album-play-btn">
                    <i class="fas ${originalIndex === currentTrackIndex && isPlaying ? 'fa-pause' : 'fa-play'}"></i>
                </button>
            </div>
            <div class="album-title">${track.title}</div>
            <div class="album-description">${track.artist}</div>
            <span class="album-genre">${track.genre}</span>
        `;

        card.addEventListener('click', (e) => {
            // Prevent double-triggering from button click
            if (e.target.closest('.album-play-btn')) {
                e.stopPropagation();
            }

            if (originalIndex === currentTrackIndex) {
                togglePlayPause();
            } else {
                loadTrack(originalIndex);
                isPlaying = true;
            }
        });

        albumGrid.appendChild(card);
    });

    // Update track count
    trackCountEl.textContent = `${tracks.length} track${tracks.length !== 1 ? 's' : ''}`;
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
        playerCover.innerHTML = `<img src="${track.cover}" alt="${track.title}" class="now-playing-cover">`;
    } else {
        playerCover.innerHTML = `<div class="now-playing-placeholder"><i class="fas fa-music"></i></div>`;
    }

    // Load audio into wavesurfer
    wavesurfer.load(track.src);

    // Update card states
    updateCardStates();
}

// Toggle play/pause
function togglePlayPause() {
    if (currentTrackIndex === -1 && tracks.length > 0) {
        loadTrack(isShuffleOn ? shuffledIndices[0] : 0);
        isPlaying = true;
        return;
    }

    wavesurfer.playPause();
}

// Play previous track
function playPrev() {
    if (tracks.length === 0) return;

    // If more than 3 seconds in, restart track
    if (wavesurfer && wavesurfer.getCurrentTime() > 3) {
        wavesurfer.seekTo(0);
        return;
    }

    loadTrack(getPrevIndex());
    isPlaying = true;
}

// Play next track
function playNext() {
    if (tracks.length === 0) return;
    loadTrack(getNextIndex());
    isPlaying = true;
}

// Handle filter clicks
function handleFilter(e) {
    const genre = e.target.dataset.genre;
    filterPills.forEach(pill => pill.classList.toggle('active', pill === e.target));

    // Also update sidebar active state
    playlistItems.forEach(item => {
        const name = item.querySelector('.playlist-name').textContent.toLowerCase();
        if (genre === 'all' && name === 'liked songs') {
            item.classList.add('active');
        } else if (name === genre) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    renderTracks(genre);
}

// Handle volume change
function handleVolumeChange(e) {
    const volume = e.target.value / 100;
    if (wavesurfer) {
        wavesurfer.setVolume(volume);
    }
    volumeBar.style.width = `${e.target.value}%`;
    updateVolumeIcon(volume);
}

// Update volume icon
function updateVolumeIcon(volume) {
    const icon = volumeBtn.querySelector('i');
    if (volume === 0) {
        icon.className = 'fas fa-volume-mute';
    } else if (volume < 0.5) {
        icon.className = 'fas fa-volume-down';
    } else {
        icon.className = 'fas fa-volume-up';
    }
}

// Toggle shuffle
function toggleShuffle() {
    isShuffleOn = !isShuffleOn;
    shuffleBtn.classList.toggle('active', isShuffleOn);
    shuffleToggle.classList.toggle('active', isShuffleOn);

    if (isShuffleOn) {
        generateShuffleOrder();
    }
}

// Toggle repeat
function toggleRepeat() {
    isRepeatOn = !isRepeatOn;
    repeatBtn.classList.toggle('active', isRepeatOn);
}

// Toggle mute
let previousVolume = 80;
function toggleMute() {
    if (wavesurfer.getVolume() > 0) {
        previousVolume = volumeSlider.value;
        volumeSlider.value = 0;
        volumeBar.style.width = '0%';
        wavesurfer.setVolume(0);
        updateVolumeIcon(0);
    } else {
        volumeSlider.value = previousVolume;
        volumeBar.style.width = `${previousVolume}%`;
        wavesurfer.setVolume(previousVolume / 100);
        updateVolumeIcon(previousVolume / 100);
    }
}

// Handle sidebar playlist clicks
function handlePlaylistClick(e) {
    const item = e.currentTarget;
    const name = item.querySelector('.playlist-name').textContent.toLowerCase();

    // Map playlist name to genre
    let genre = 'all';
    if (name === 'electronic') genre = 'electronic';
    else if (name === 'ambient') genre = 'ambient';
    else if (name === 'experimental') genre = 'experimental';

    // Update filter pills
    filterPills.forEach(pill => {
        pill.classList.toggle('active', pill.dataset.genre === genre);
    });

    // Update sidebar
    playlistItems.forEach(pl => pl.classList.remove('active'));
    item.classList.add('active');

    renderTracks(genre);
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initWaveSurfer();
    generateShuffleOrder();
    renderTracks();

    // Event listeners
    playPauseBtn.addEventListener('click', togglePlayPause);
    mainPlayBtn.addEventListener('click', togglePlayPause);
    prevBtn.addEventListener('click', playPrev);
    nextBtn.addEventListener('click', playNext);
    volumeSlider.addEventListener('input', handleVolumeChange);
    volumeBtn.addEventListener('click', toggleMute);
    filterPills.forEach(pill => pill.addEventListener('click', handleFilter));
    shuffleBtn.addEventListener('click', toggleShuffle);
    shuffleToggle.addEventListener('click', toggleShuffle);
    repeatBtn.addEventListener('click', toggleRepeat);

    // Sidebar playlist clicks
    playlistItems.forEach(item => {
        item.addEventListener('click', handlePlaylistClick);
    });

    // Keyboard controls
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT') return;

        switch(e.code) {
            case 'Space':
                e.preventDefault();
                togglePlayPause();
                break;
            case 'ArrowLeft':
                if (e.shiftKey) {
                    playPrev();
                } else if (wavesurfer) {
                    wavesurfer.skip(-10);
                }
                break;
            case 'ArrowRight':
                if (e.shiftKey) {
                    playNext();
                } else if (wavesurfer) {
                    wavesurfer.skip(10);
                }
                break;
            case 'KeyM':
                toggleMute();
                break;
            case 'KeyS':
                toggleShuffle();
                break;
            case 'KeyR':
                toggleRepeat();
                break;
        }
    });

    // Set initial volume bar width
    volumeBar.style.width = `${volumeSlider.value}%`;
});
