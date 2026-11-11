/**
 * AURA MED - Scroll Frame-by-Frame Animation Engine
 * Ultra-responsive 60fps canvas sequence controller with preloading,
 * lerp inertia smoothing, timeline scrubbing, and audio feedback.
 */

(function () {
  'use strict';

  const TOTAL_FRAMES = 300;
  const FRAME_DIR = 'frames';
  const FRAME_PREFIX = 'ezgif-frame-';
  const FRAME_EXT = '.jpg';

  // DOM Elements
  const preloader = document.getElementById('preloader');
  const preloaderBar = document.getElementById('preloader-bar');
  const preloaderPercent = document.getElementById('preloader-percent');
  const preloaderText = document.getElementById('preloader-text');

  const heroSection = document.getElementById('hero-section');
  const stickyStage = document.getElementById('sticky-stage');
  const video = document.getElementById('hero-video');
  const canvas = document.getElementById('hero-canvas');
  const ctx = canvas.getContext('2d', { alpha: false });

  const mediaModeBtn = document.getElementById('media-mode-btn');
  const mediaModeText = document.getElementById('media-mode-text');
  const clarityBoostBtn = document.getElementById('clarity-boost-btn');
  const focusBtn = document.getElementById('focus-btn');
  const fitBtn = document.getElementById('fit-btn');

  const hudFrameNum = document.getElementById('hud-frame-num');
  const hudPercent = document.getElementById('hud-percent');
  const gaugeFill = document.getElementById('gauge-fill');
  const timelineFill = document.getElementById('timeline-fill');
  const timelineThumb = document.getElementById('timeline-thumb');
  const timelineScrubber = document.getElementById('timeline-scrubber');
  const autoplayBtn = document.getElementById('autoplay-btn');
  const speedBtn = document.getElementById('speed-btn');
  const soundBtn = document.getElementById('sound-btn');
  const navbar = document.getElementById('navbar');

  const storyCards = [
    document.getElementById('story-phase-1'),
    document.getElementById('story-phase-2'),
    document.getElementById('story-phase-3'),
    document.getElementById('story-phase-4')
  ];

  // State
  const images = new Array(TOTAL_FRAMES + 1); // 1-indexed
  let loadedCount = 0;
  let isReady = false;
  let currentMediaMode = 'video'; // 'video' (Ultra-HD master) or 'canvas' (frames)
  let clarityFilterIndex = 0;
  const clarityFilters = ['clarity-boost', 'clarity-hdr', 'clarity-natural'];
  const clarityFilterNames = ['✨ Ultra-Sharp', '🌈 Cinema HDR', '📷 Natural'];

  let activePhase = 1;
  let targetProgress = 0;
  let currentProgress = 0;
  let lastRenderedIndex = -1;
  let isAutoplaying = false;
  let autoplayAnimationId = null;
  let playbackSpeed = 0.75; // Default playback speed set to 0.75x
  let isDraggingScrubber = false;
  let isSeeking = false;
  let audioContext = null;
  let soundEnabled = false;

  /**
   * Helper to format zero-padded frame numbers (e.g. 1 -> "001")
   */
  function formatIndex(index) {
    return String(index).padStart(3, '0');
  }

  function getFrameSrc(index) {
    return `${FRAME_DIR}/${FRAME_PREFIX}${formatIndex(index)}${FRAME_EXT}`;
  }

  /**
   * Fast Preloader: Instant unlock with graceful streaming
   */
  function preloadImages() {
    let dismissed = false;

    function dismissPreloader() {
      if (dismissed) return;
      dismissed = true;
      isReady = true;
      document.body.classList.remove('is-loading');
      if (preloader) {
        preloader.classList.add('fade-out');
      }
      onResize();
      if (images[1] || lastRenderedIndex > 0) {
        renderFrame(1);
      }
    }

    // Safety timeout: dismiss immediately (within 600ms) so user is NEVER blocked at 0%
    setTimeout(dismissPreloader, 600);

    // If video can play, dismiss immediately
    if (video) {
      if (video.readyState >= 2) {
        dismissPreloader();
      } else {
        video.addEventListener('canplay', () => dismissPreloader(), { once: true });
        video.addEventListener('loadeddata', () => dismissPreloader(), { once: true });
      }
    }

    for (let i = 1; i <= TOTAL_FRAMES; i++) {
      const img = new Image();
      img.src = getFrameSrc(i);
      img.onload = () => {
        loadedCount++;
        images[i] = img;

        const percent = Math.min(100, Math.round((loadedCount / TOTAL_FRAMES) * 100));
        if (preloaderBar) preloaderBar.style.width = `${percent}%`;
        if (preloaderPercent) preloaderPercent.textContent = `${percent}%`;

        if (loadedCount < TOTAL_FRAMES && preloaderText) {
          preloaderText.textContent = `Streaming frames (${loadedCount}/${TOTAL_FRAMES})...`;
        }

        if (i === 1 && !lastRenderedIndex) {
          renderFrame(1);
        }

        // Dismiss preloader once initial frames arrive
        if (loadedCount >= 5) {
          dismissPreloader();
        }

        if (loadedCount === TOTAL_FRAMES && preloaderText) {
          preloaderText.textContent = '300 Frames Ready.';
        }
      };

      img.onerror = () => {
        loadedCount++;
        if (loadedCount >= 5) {
          dismissPreloader();
        }
      };
    }
  }

  /**
   * Responsive High-DPI Canvas Sizing
   */
  function onResize() {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);

    if (lastRenderedIndex > 0) {
      renderFrame(lastRenderedIndex);
    }
  }

  /**
   * Render specific image frame onto canvas with cover-fit math
   */
  function renderFrame(frameIndex) {
    const clampedIndex = Math.min(TOTAL_FRAMES, Math.max(1, frameIndex));
    let img = images[clampedIndex];

    // Fallback to nearest loaded frame if current isn't ready
    if (!img || !img.complete) {
      for (let offset = 1; offset < 30; offset++) {
        if (images[clampedIndex - offset] && images[clampedIndex - offset].complete) {
          img = images[clampedIndex - offset];
          break;
        } else if (images[clampedIndex + offset] && images[clampedIndex + offset].complete) {
          img = images[clampedIndex + offset];
          break;
        }
      }
    }

    if (!img || !img.complete || img.naturalWidth === 0) return;

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Calculate aspect cover dimensions
    const cWidth = canvas.width;
    const cHeight = canvas.height;
    const iWidth = img.naturalWidth;
    const iHeight = img.naturalHeight;

    const scale = Math.max(cWidth / iWidth, cHeight / iHeight);
    const drawWidth = iWidth * scale;
    const drawHeight = iHeight * scale;
    const x = (cWidth - drawWidth) / 2;
    const y = (cHeight - drawHeight) / 2;

    ctx.fillStyle = '#04060a';
    ctx.fillRect(0, 0, cWidth, cHeight);
    ctx.drawImage(img, x, y, drawWidth, drawHeight);
    ctx.restore();

    lastRenderedIndex = clampedIndex;
  }

  /**
   * Web Audio API subtle chime / pulse for interaction
   */
  function initAudio() {
    if (!audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        audioContext = new AudioCtx();
      }
    }
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume();
    }
  }

  function playHarmonicTone(freq = 440, duration = 0.25) {
    if (!soundEnabled || !audioContext) return;
    try {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, audioContext.currentTime);

      gain.gain.setValueAtTime(0.04, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);

      osc.connect(gain);
      gain.connect(audioContext.destination);

      osc.start();
      osc.stop(audioContext.currentTime + duration);
    } catch (e) {
      // Audio autoplay policy
    }
  }

  /**
   * Scroll calculation: Map window scroll to hero section progress
   */
  function calculateScrollProgress() {
    if (!heroSection) return 0;

    const rect = heroSection.getBoundingClientRect();
    const totalScrollable = rect.height - window.innerHeight;

    if (totalScrollable <= 0) return 0;

    // rect.top is 0 when hero reaches top, negative as user scrolls down
    const scrolled = -rect.top;
    const progress = Math.min(1, Math.max(0, scrolled / totalScrollable));
    return progress;
  }

  /**
   * Smooth Animation Loop (Lerp Inertia)
   */
  function animationLoop() {
    if (!isAutoplaying && !isDraggingScrubber) {
      targetProgress = calculateScrollProgress();
    }

    // Lerp smoothing: Apple-like fluid glide
    const lerpFactor = 0.14;
    currentProgress += (targetProgress - currentProgress) * lerpFactor;

    // Avoid micro-jitter
    if (Math.abs(targetProgress - currentProgress) < 0.0001) {
      currentProgress = targetProgress;
    }

    // Map progress to frame index (1 to 300)
    const frameIndex = Math.min(TOTAL_FRAMES, Math.max(1, Math.round(currentProgress * (TOTAL_FRAMES - 1)) + 1));

    // Sync video playback to scroll position when paused or scrubbing
    if (video && video.duration) {
      if (!isAutoplaying && (video.paused || isDraggingScrubber)) {
        const targetTime = currentProgress * video.duration;
        if (!isSeeking && Math.abs(video.currentTime - targetTime) > 0.08) {
          isSeeking = true;
          video.currentTime = targetTime;
        }
      }
    }

    // Always render frame on canvas so there is never a blank screen
    if (frameIndex !== lastRenderedIndex) {
      renderFrame(frameIndex);
    }

    updateHUD(frameIndex, currentProgress);
    updateStoryCards(currentProgress);
    lastRenderedIndex = frameIndex;

    requestAnimationFrame(animationLoop);
  }

  /**
   * Update HUD metrics & Scrubber positions
   */
  function updateHUD(frameIndex, progress) {
    const percentInt = Math.round(progress * 100);

    if (hudFrameNum) {
      hudFrameNum.innerHTML = `${formatIndex(frameIndex)} <span class="dim">/ ${TOTAL_FRAMES}</span>`;
    }

    if (hudPercent) {
      hudPercent.textContent = `${percentInt}%`;
    }

    if (gaugeFill) {
      // 100 perimeter for dasharray
      gaugeFill.setAttribute('stroke-dasharray', `${percentInt}, 100`);
    }

    if (timelineFill) {
      timelineFill.style.width = `${progress * 100}%`;
    }

    if (timelineThumb) {
      timelineThumb.style.left = `${progress * 100}%`;
    }
  }

  /**
   * Synchronize narrative text overlays according to progress phases
   */
  function updateStoryCards(progress) {
    let nextPhase = 1;
    if (progress < 0.24) {
      nextPhase = 1;
    } else if (progress < 0.52) {
      nextPhase = 2;
    } else if (progress < 0.77) {
      nextPhase = 3;
    } else {
      nextPhase = 4;
    }

    if (nextPhase !== activePhase) {
      activePhase = nextPhase;
      storyCards.forEach((card, idx) => {
        if (!card) return;
        if (idx + 1 === activePhase) {
          card.classList.add('active');
        } else {
          card.classList.remove('active');
        }
      });

      // Sound chime on phase shift
      const frequencies = [440, 523.25, 659.25, 880];
      playHarmonicTone(frequencies[activePhase - 1], 0.35);
    }
  }

  /**
   * Interactive Timeline Scrubber (Click and Drag)
   */
  function setupTimelineScrubber() {
    if (!timelineScrubber) return;

    function handleScrub(e) {
      const rect = timelineScrubber.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const scrubProgress = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));

      // Scroll the window smoothly to match the scrub position
      const heroRect = heroSection.getBoundingClientRect();
      const heroTopAbs = window.pageYOffset + heroRect.top;
      const totalScrollable = heroRect.height - window.innerHeight;
      const targetScrollY = heroTopAbs + scrubProgress * totalScrollable;

      window.scrollTo({
        top: targetScrollY,
        behavior: 'auto'
      });

      targetProgress = scrubProgress;
      if (currentMediaMode === 'video' && video && video.duration) {
        video.currentTime = scrubProgress * video.duration;
      }
    }

    timelineScrubber.addEventListener('mousedown', (e) => {
      isDraggingScrubber = true;
      initAudio();
      handleScrub(e);

      function onMouseMove(moveEvt) {
        if (isDraggingScrubber) {
          handleScrub(moveEvt);
        }
      }

      function onMouseUp() {
        isDraggingScrubber = false;
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      }

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });

    // Touch events for mobile scrub
    timelineScrubber.addEventListener('touchstart', (e) => {
      isDraggingScrubber = true;
      initAudio();
      handleScrub(e);
    }, { passive: true });

    timelineScrubber.addEventListener('touchmove', (e) => {
      if (isDraggingScrubber) {
        handleScrub(e);
      }
    }, { passive: true });

    timelineScrubber.addEventListener('touchend', () => {
      isDraggingScrubber = false;
    });
  }

  /**
   * Autoplay Demo Controller
   */
  function setupAutoplay() {
    if (!autoplayBtn) return;

    autoplayBtn.addEventListener('click', () => {
      initAudio();
      isAutoplaying = !isAutoplaying;

      if (isAutoplaying) {
        autoplayBtn.classList.add('playing');
        autoplayBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="currentColor" class="play-icon">
            <rect x="6" y="4" width="4" height="16"/>
            <rect x="14" y="4" width="4" height="16"/>
          </svg>
        `;
        runAutoplaySequence();
      } else {
        stopAutoplay();
      }
    });

    // Stop autoplay whenever the user manually scrolls
    window.addEventListener('wheel', () => {
      if (isAutoplaying) stopAutoplay();
    }, { passive: true });
    window.addEventListener('touchmove', () => {
      if (isAutoplaying) stopAutoplay();
    }, { passive: true });
  }

  function stopAutoplay() {
    isAutoplaying = false;
    if (autoplayBtn) {
      autoplayBtn.classList.remove('playing');
      autoplayBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="currentColor" class="play-icon">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
      `;
    }
    if (autoplayAnimationId) {
      if (typeof autoplayAnimationId === 'object' && autoplayAnimationId.stop) {
        autoplayAnimationId.stop();
      } else {
        cancelAnimationFrame(autoplayAnimationId);
      }
      autoplayAnimationId = null;
    }
    if (video) {
      video.pause();
    }
  }

  function runAutoplaySequence() {
    if (currentMediaMode === 'video' && video) {
      video.playbackRate = playbackSpeed;
      video.currentTime = currentProgress * (video.duration || 10);
      video.play().catch(() => {});

      function onVideoTimeUpdate() {
        if (!isAutoplaying) return;
        if (!video.duration) return;
        currentProgress = video.currentTime / video.duration;
        targetProgress = currentProgress;

        const heroRect = heroSection.getBoundingClientRect();
        const heroTopAbs = window.pageYOffset + heroRect.top;
        const totalScrollable = heroRect.height - window.innerHeight;
        const targetScrollY = heroTopAbs + currentProgress * totalScrollable;

        window.scrollTo({
          top: targetScrollY,
          behavior: 'auto'
        });

        if (video.ended || currentProgress >= 0.999) {
          video.currentTime = 0;
          currentProgress = 0;
          targetProgress = 0;
        }
      }

      video.addEventListener('timeupdate', onVideoTimeUpdate);
      autoplayAnimationId = {
        stop: () => {
          video.pause();
          video.removeEventListener('timeupdate', onVideoTimeUpdate);
        }
      };
      return;
    }

    let playProgress = currentProgress;
    const baseStepSpeed = 0.0025;

    function step() {
      if (!isAutoplaying) return;

      const stepSpeed = baseStepSpeed * playbackSpeed;
      playProgress += stepSpeed;
      if (playProgress > 1) {
        playProgress = 0;
      }

      const heroRect = heroSection.getBoundingClientRect();
      const heroTopAbs = window.pageYOffset + heroRect.top;
      const totalScrollable = heroRect.height - window.innerHeight;
      const targetScrollY = heroTopAbs + playProgress * totalScrollable;

      window.scrollTo({
        top: targetScrollY,
        behavior: 'auto'
      });

      targetProgress = playProgress;
      autoplayAnimationId = requestAnimationFrame(step);
    }

    autoplayAnimationId = requestAnimationFrame(step);
  }

  /**
   * Sound Toggle Controller
   */
  function setupSoundToggle() {
    if (!soundBtn) return;

    soundBtn.addEventListener('click', () => {
      initAudio();
      soundEnabled = !soundEnabled;

      if (soundEnabled) {
        soundBtn.classList.remove('muted');
        soundBtn.title = 'Mute Sound FX';
        playHarmonicTone(587.33, 0.2); // D5 chime
      } else {
        soundBtn.classList.add('muted');
        soundBtn.title = 'Unmute Sound FX';
      }
    });
  }

  /**
   * Speed button: cycle speeds, defaults to 0.75x
   */
  function setupSpeedButton() {
    if (!speedBtn) return;
    const speeds = [0.5, 0.75, 1.0, 1.25];
    let speedIndex = speeds.indexOf(playbackSpeed);
    if (speedIndex === -1) speedIndex = 1; // 0.75

    speedBtn.textContent = `${playbackSpeed}x`;

    speedBtn.addEventListener('click', () => {
      initAudio();
      speedIndex = (speedIndex + 1) % speeds.length;
      playbackSpeed = speeds[speedIndex];
      speedBtn.textContent = `${playbackSpeed}x`;
      speedBtn.title = `Playback Speed: ${playbackSpeed}x (Click to cycle)`;

      // Dynamically adjust scroll track height so manual scrolling also matches speed:
      if (heroSection) {
        heroSection.style.height = `${Math.round(450 / playbackSpeed)}vh`;
      }
      if (video) {
        video.playbackRate = playbackSpeed;
      }
    });
  }

  /**
   * Replay button: Smooth scroll back to beginning
   */
  function setupReplayButton() {
    const replayBtn = document.getElementById('replay-btn');
    if (replayBtn) {
      replayBtn.addEventListener('click', () => {
        initAudio();
        if (video) {
          video.currentTime = 0;
        }
        window.scrollTo({
          top: 0,
          behavior: 'smooth'
        });
      });
    }
  }

  /**
   * Video Scroll Playback:
   * When the user scrolls inside the hero section, the video plays smoothly!
   * Automatically pauses when scrolling stops or leaves the hero section.
   */
  function setupVideoScrollPlayback() {
    if (!video) return;

    video.muted = true;
    video.playsInline = true;

    // Mobile priming: unlock video on first touch/tap
    function unlockMobileVideo() {
      if (video) {
        video.muted = true;
        const playPromise = video.play();
        if (playPromise !== undefined) {
          playPromise.then(() => {
            // Once unlocked, pause until scroll
            const heroRect = heroSection ? heroSection.getBoundingClientRect() : null;
            const inHero = heroRect && heroRect.top <= 80 && heroRect.bottom >= 100;
            if (!inHero) {
              video.pause();
            }
          }).catch(() => {});
        }
      }
      window.removeEventListener('touchstart', unlockMobileVideo);
      window.removeEventListener('click', unlockMobileVideo);
    }
    window.addEventListener('touchstart', unlockMobileVideo, { passive: true, once: true });
    window.addEventListener('click', unlockMobileVideo, { passive: true, once: true });

    video.addEventListener('seeked', () => { isSeeking = false; });
    video.addEventListener('error', () => { isSeeking = false; });

    let scrollVideoTimer = null;

    function handleScrollAction() {
      if (!heroSection || !video) return;
      const heroRect = heroSection.getBoundingClientRect();
      const inHero = heroRect.top <= 80 && heroRect.bottom >= 100;

      if (inHero) {
        if (video.paused) {
          video.play().catch(() => {});
        }
        clearTimeout(scrollVideoTimer);
        scrollVideoTimer = setTimeout(() => {
          if (!isAutoplaying && video && !video.paused) {
            video.pause();
          }
        }, 400);
      } else {
        if (!video.paused) {
          video.pause();
        }
      }
    }

    window.addEventListener('scroll', handleScrollAction, { passive: true });
    window.addEventListener('touchmove', handleScrollAction, { passive: true });
  }

  /**
   * Clarity Controls: Ultra-HD Video Switcher, Sharpness Boost, Clean View, Aspect Mode
   */
  function setupClarityControls() {
    // 1. Media Mode Toggle (Ultra-HD Video vs Canvas Frames)
    if (mediaModeBtn) {
      mediaModeBtn.addEventListener('click', () => {
        initAudio();
        if (currentMediaMode === 'video') {
          currentMediaMode = 'canvas';
          document.body.classList.add('mode-canvas');
          if (mediaModeText) mediaModeText.textContent = '🎞️ Canvas Frames';
          mediaModeBtn.classList.remove('active');
          const frameIndex = Math.min(TOTAL_FRAMES, Math.max(1, Math.round(currentProgress * (TOTAL_FRAMES - 1)) + 1));
          renderFrame(frameIndex);
        } else {
          currentMediaMode = 'video';
          document.body.classList.remove('mode-canvas');
          if (mediaModeText) mediaModeText.textContent = '💎 Ultra-HD Video';
          mediaModeBtn.classList.add('active');
          if (video && video.duration) {
            video.currentTime = currentProgress * video.duration;
          }
        }
      });
    }

    // 2. HD Clarity Sharpness Boost Filter
    if (clarityBoostBtn) {
      clarityBoostBtn.addEventListener('click', () => {
        initAudio();
        const mediaElements = [video, canvas];
        clarityFilterIndex = (clarityFilterIndex + 1) % clarityFilters.length;
        const currentFilter = clarityFilters[clarityFilterIndex];

        mediaElements.forEach(el => {
          if (!el) return;
          clarityFilters.forEach(f => el.classList.remove(f));
          el.classList.add(currentFilter);
        });

        clarityBoostBtn.title = `Clarity Mode: ${clarityFilterNames[clarityFilterIndex]} (Click to cycle)`;
        if (currentFilter === 'clarity-natural') {
          clarityBoostBtn.classList.remove('active');
        } else {
          clarityBoostBtn.classList.add('active');
        }
      });
    }

    // 3. Clean View (Focus Mode - Full unobstructed screen)
    if (focusBtn) {
      focusBtn.addEventListener('click', () => {
        initAudio();
        const isClean = document.body.classList.toggle('clean-view');
        focusBtn.classList.toggle('active', isClean);
        focusBtn.title = isClean ? 'Exit Clean View (Show Info)' : 'Toggle Clean View (Unobstructed Fullscreen Video)';
      });
    }

    // 4. Aspect Ratio (Fill vs 100% Crisp Contain)
    if (fitBtn && stickyStage) {
      fitBtn.addEventListener('click', () => {
        initAudio();
        const isContain = stickyStage.classList.toggle('contain-mode');
        fitBtn.classList.toggle('active', isContain);
        fitBtn.title = isContain ? 'Aspect: 100% Crisp Contain (True Pixels)' : 'Aspect: Full Screen Fill';
      });
    }
  }

  /**
   * Navbar scroll effect & Scroll Spy for Section Links
   */
  function setupNavbar() {
    const navLinks = document.querySelectorAll('.nav-link');
    const sections = [
      document.getElementById('hero-section'),
      document.getElementById('tribute-intro'),
      document.getElementById('timeline-journey'),
      document.getElementById('upload-memory-vault'),
      document.getElementById('friendship-vault')
    ].filter(Boolean);

    window.addEventListener('scroll', () => {
      // Navbar backdrop styling
      if (window.scrollY > 50) {
        navbar.classList.add('scrolled');
      } else {
        navbar.classList.remove('scrolled');
      }

      // Scroll Spy: update active link
      let currentSectionId = '';
      const scrollPos = window.scrollY + 200;

      sections.forEach(section => {
        if (section.offsetTop <= scrollPos) {
          currentSectionId = section.getAttribute('id');
        }
      });

      if (currentSectionId) {
        navLinks.forEach(link => {
          if (link.getAttribute('href') === `#${currentSectionId}`) {
            link.classList.add('active');
          } else {
            link.classList.remove('active');
          }
        });
      }
    }, { passive: true });
  }

  /**
   * Memory Vault Interactive Features: Reactions & Guestbook
   */
  function setupVaultInteractions() {
    // 1. Interactive Reaction Counters
    const reactionButtons = document.querySelectorAll('.reaction-btn');
    reactionButtons.forEach(btn => {
      btn.addEventListener('click', function () {
        initAudio();
        const countSpan = this.querySelector('.count-display');
        let currentCount = parseInt(this.getAttribute('data-count'), 10) || 0;
        currentCount += 1;
        this.setAttribute('data-count', currentCount);

        if (countSpan) {
          countSpan.textContent = currentCount.toLocaleString();
        }

        // Bouncy micro-animation
        this.style.transform = 'scale(1.15)';
        setTimeout(() => {
          this.style.transform = '';
        }, 200);

        // Sound chime on reaction
        playHarmonicTone(659.25, 0.2); // E5 chime
      });
    });

    // 2. Interactive Keepsake Scrapbook Submission Form
    const tributeForm = document.getElementById('tributeForm');
    const notesContainer = document.getElementById('notesContainer');
    const slipsCountBadge = document.getElementById('slips-count-badge');
    let totalEntries = 12;

    if (tributeForm && notesContainer) {
      tributeForm.addEventListener('submit', (e) => {
        e.preventDefault();
        initAudio();

        const nameInput = document.getElementById('contributorName');
        const milestoneInput = document.getElementById('milestoneTag');
        const messageInput = document.getElementById('contributorMessage');

        const name = nameInput ? nameInput.value.trim() : '';
        const milestone = milestoneInput ? milestoneInput.value : 'Special Wish';
        const message = messageInput ? messageInput.value.trim() : '';

        if (!name || !message) return;

        // Escape HTML for safety
        const safeName = name.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const safeMilestone = milestone.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const safeMessage = message.replace(/</g, '&lt;').replace(/>/g, '&gt;');

        totalEntries++;
        if (slipsCountBadge) {
          slipsCountBadge.textContent = `${totalEntries} Fresh Entries`;
        }

        const newSlip = document.createElement('div');
        newSlip.className = 'scrapbook-slip-card pinned-highlight';
        newSlip.innerHTML = `
          <div class="slip-header">
            <span class="slip-author">${safeName}</span>
            <span class="slip-tag gold">${safeMilestone}</span>
          </div>
          <p class="slip-body">&ldquo;${safeMessage}&rdquo;</p>
          <div class="slip-footer">
            <span class="slip-time">Just pinned to Kumuda's memory album</span>
            <span class="material-symbols-outlined text-rose" style="font-variation-settings: 'FILL' 1;">favorite</span>
          </div>
        `;

        notesContainer.prepend(newSlip);
        tributeForm.reset();

        // Celebration chime
        playHarmonicTone(523.25, 0.15); // C5
        setTimeout(() => playHarmonicTone(783.99, 0.25), 120); // G5
      });
    }
  }

  /**
   * Photo Upload & Keepsake Contribution Studio
   * Supports drag & drop, file picker, real-time live Polaroid preview,
   * custom sticker badges, thoughts reflection, and persistent community wall.
   */
  function setupPhotoUploadStudio() {
    const photoUploadForm = document.getElementById('photoUploadForm');
    const photoDropzone = document.getElementById('photoDropzone');
    const photoFileInput = document.getElementById('photoFileInput');
    const dropzoneIdle = document.getElementById('dropzoneIdle');
    const dropzonePreview = document.getElementById('dropzonePreview');
    const dropzoneThumb = document.getElementById('dropzoneThumb');
    const changePhotoBtn = document.getElementById('changePhotoBtn');
    const removePhotoBtn = document.getElementById('removePhotoBtn');

    const photoAuthor = document.getElementById('photoAuthor');
    const photoCategory = document.getElementById('photoCategory');
    const photoThoughts = document.getElementById('photoThoughts');
    const stickerChips = document.querySelectorAll('#stickerSelector .sticker-chip');

    const livePolaroidCard = document.getElementById('livePolaroidCard');
    const previewImgElement = document.getElementById('previewImgElement');
    const previewStampBadge = document.getElementById('previewStampBadge');
    const previewCaptionText = document.getElementById('previewCaptionText');
    const previewAuthorText = document.getElementById('previewAuthorText');
    const previewTagPill = document.getElementById('previewTagPill');

    const polaroidsContainer = document.getElementById('polaroidsContainer');
    const wallCountPill = document.getElementById('wall-count-pill');

    if (!photoUploadForm || !photoDropzone || !polaroidsContainer) return;

    const DEFAULT_PHOTO = 'images/kumuda_omana_besties.jpg';
    let currentPhotoSrc = DEFAULT_PHOTO;
    let currentSticker = '❤️ Soul Sisters';

    function escapeHTML(str) {
      if (!str) return '';
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function updateWallCount() {
      if (!wallCountPill) return;
      const count = document.querySelectorAll('.wall-polaroid-item').length;
      wallCountPill.textContent = `${count} Keepsakes Pinned`;
    }

    // Helper: process image file with downscaling if needed
    function processImageFile(file) {
      if (!file || !file.type.startsWith('image/')) {
        showToast('Please select a valid image file (JPG, PNG, WEBP).', 'warning');
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          // Downscale to max dimension 1200px for optimal speed & localStorage storage
          const maxDim = 1200;
          let w = img.width;
          let h = img.height;
          if (w > maxDim || h > maxDim) {
            if (w > h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = w;
          tempCanvas.height = h;
          const tempCtx = tempCanvas.getContext('2d');
          tempCtx.drawImage(img, 0, 0, w, h);
          currentPhotoSrc = tempCanvas.toDataURL('image/jpeg', 0.85);

          // Update Dropzone preview
          if (dropzoneThumb) dropzoneThumb.src = currentPhotoSrc;
          if (dropzoneIdle) dropzoneIdle.classList.add('hidden');
          if (dropzonePreview) dropzonePreview.classList.remove('hidden');

          // Update Live Polaroid Preview
          if (previewImgElement) previewImgElement.src = currentPhotoSrc;

          // Bouncy preview animation
          if (livePolaroidCard) {
            livePolaroidCard.style.transform = 'scale(1.04) rotate(0deg)';
            setTimeout(() => {
              livePolaroidCard.style.transform = '';
            }, 300);
          }

          initAudio();
          playHarmonicTone(783.99, 0.2); // G5 chime
          showToast('Photo loaded successfully! Review your live polaroid preview.', 'success');
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    }

    // 1. File Input & Dropzone triggers
    photoDropzone.addEventListener('click', (e) => {
      if (e.target.closest('#changePhotoBtn') || e.target.closest('#removePhotoBtn')) return;
      if (dropzonePreview && !dropzonePreview.classList.contains('hidden')) return;
      photoFileInput.click();
    });

    photoDropzone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        photoFileInput.click();
      }
    });

    if (changePhotoBtn) {
      changePhotoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        photoFileInput.click();
      });
    }

    if (removePhotoBtn) {
      removePhotoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        currentPhotoSrc = DEFAULT_PHOTO;
        photoFileInput.value = '';
        if (dropzonePreview) dropzonePreview.classList.add('hidden');
        if (dropzoneIdle) dropzoneIdle.classList.remove('hidden');
        if (previewImgElement) previewImgElement.src = DEFAULT_PHOTO;
        initAudio();
        playHarmonicTone(440, 0.15);
      });
    }

    photoFileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        processImageFile(e.target.files[0]);
      }
    });

    // Drag and drop events
    ['dragenter', 'dragover'].forEach(eventName => {
      photoDropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        photoDropzone.classList.add('dragover');
      }, false);
    });

    ['dragleave', 'dragend'].forEach(eventName => {
      photoDropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        photoDropzone.classList.remove('dragover');
      }, false);
    });

    photoDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      photoDropzone.classList.remove('dragover');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        processImageFile(e.dataTransfer.files[0]);
      }
    }, false);

    // 2. Real-time Live Inputs
    if (photoThoughts) {
      photoThoughts.addEventListener('input', () => {
        const val = photoThoughts.value.trim();
        if (previewCaptionText) {
          if (val) {
            previewCaptionText.innerHTML = `&ldquo;${escapeHTML(val)}&rdquo;`;
          } else {
            previewCaptionText.innerHTML = '&ldquo;Zero studying, maximum conversation &bull; Kumuda &amp; Omana&rdquo;';
          }
        }
      });
    }

    if (photoAuthor) {
      photoAuthor.addEventListener('input', () => {
        const val = photoAuthor.value.trim();
        if (previewAuthorText) {
          previewAuthorText.textContent = val || 'Omana • Best Friend';
        }
      });
    }

    if (photoCategory) {
      photoCategory.addEventListener('change', () => {
        const selText = photoCategory.options[photoCategory.selectedIndex].text;
        if (previewTagPill) {
          previewTagPill.textContent = selText.split('(')[0].trim();
        }
      });
    }

    // Sticker selection chips
    stickerChips.forEach(chip => {
      chip.addEventListener('click', () => {
        stickerChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        currentSticker = chip.getAttribute('data-sticker') || chip.textContent.trim();
        if (previewStampBadge) {
          previewStampBadge.textContent = currentSticker;
        }
        initAudio();
        playHarmonicTone(880, 0.12);
      });
    });

    // 3. Render Polaroid helper
    function createPolaroidElement(data, isNew = false) {
      const pinIcons = ['push_pin', 'grade', 'stars', 'favorite', 'verified'];
      const randomPin = pinIcons[Math.floor(Math.random() * pinIcons.length)];
      const rotationClass = Math.random() > 0.5 ? 'rotate-right' : 'rotate-left';

      const item = document.createElement('div');
      item.className = 'wall-polaroid-item';
      if (isNew) {
        item.style.animation = 'polaroid-drop-in 0.6s cubic-bezier(0.16, 1, 0.3, 1)';
      }

      item.innerHTML = `
        <div class="polaroid-card ${rotationClass}">
          <div class="polaroid-pin">
            <span class="material-symbols-outlined text-gold">${randomPin}</span>
          </div>
          <div class="polaroid-img-wrap">
            <img src="${data.image}" alt="${escapeHTML(data.author)}" class="polaroid-img" loading="lazy">
            <span class="polaroid-stamp">${escapeHTML(data.sticker || '❤️ Soul Sisters')}</span>
          </div>
          <div class="polaroid-caption">
            <p>&ldquo;${escapeHTML(data.thoughts)}&rdquo;</p>
            <div class="polaroid-author-bar">
              <span class="polaroid-author">${escapeHTML(data.author)}</span>
              <button class="reaction-btn" data-count="${data.likes || 1}" type="button" aria-label="Love this photo">
                <span class="material-symbols-outlined btn-heart" style="font-variation-settings: 'FILL' 1;">favorite</span>
                <span class="count-display">${data.likes || 1}</span>
              </button>
            </div>
          </div>
        </div>
      `;

      // Wire reaction button
      const rxnBtn = item.querySelector('.reaction-btn');
      if (rxnBtn) {
        rxnBtn.addEventListener('click', function () {
          initAudio();
          let count = parseInt(this.getAttribute('data-count'), 10) || 0;
          count += 1;
          this.setAttribute('data-count', count);
          const countDisplay = this.querySelector('.count-display');
          if (countDisplay) countDisplay.textContent = count.toLocaleString();

          this.style.transform = 'scale(1.18)';
          setTimeout(() => { this.style.transform = ''; }, 200);
          playHarmonicTone(659.25, 0.2); // E5

          // Update localStorage likes if it's a stored polaroid
          try {
            const stored = JSON.parse(localStorage.getItem('vault_user_polaroids') || '[]');
            const idx = stored.findIndex(m => m.id === data.id);
            if (idx !== -1) {
              stored[idx].likes = count;
              localStorage.setItem('vault_user_polaroids', JSON.stringify(stored));
            }
          } catch (e) {
            // ignore
          }
        });
      }

      return item;
    }

    // 4. Form Submission
    photoUploadForm.addEventListener('submit', (e) => {
      e.preventDefault();
      initAudio();

      const author = photoAuthor ? photoAuthor.value.trim() : '';
      const thoughts = photoThoughts ? photoThoughts.value.trim() : '';
      const category = photoCategory ? photoCategory.options[photoCategory.selectedIndex].text : '';

      if (!author || !thoughts) {
        showToast('Please enter your name and thoughts before pinning.', 'warning');
        return;
      }

      const newMemory = {
        id: 'vault_' + Date.now(),
        author: author,
        thoughts: thoughts,
        category: category,
        sticker: currentSticker,
        image: currentPhotoSrc,
        likes: 1,
        timestamp: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      };

      // Save to localStorage
      try {
        const stored = JSON.parse(localStorage.getItem('vault_user_polaroids') || '[]');
        stored.unshift(newMemory);
        // Keep max 20 memories in localStorage
        if (stored.length > 20) stored.length = 20;
        localStorage.setItem('vault_user_polaroids', JSON.stringify(stored));
      } catch (err) {
        console.warn('Storage quota exceeded, continuing in-memory:', err);
      }

      // Prepend to wall
      const cardEl = createPolaroidElement(newMemory, true);
      polaroidsContainer.prepend(cardEl);
      updateWallCount();

      // Celebration fanfare
      playHarmonicTone(523.25, 0.15); // C5
      setTimeout(() => playHarmonicTone(659.25, 0.15), 100); // E5
      setTimeout(() => playHarmonicTone(783.99, 0.22), 200); // G5
      setTimeout(() => playHarmonicTone(1046.50, 0.35), 320); // C6

      showToast('🎉 Polaroid pinned to Kumuda\'s Keepsake Wall!', 'success');

      // Scroll smoothly down to the freshly pinned photo
      cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      // Reset form
      photoUploadForm.reset();
      currentPhotoSrc = DEFAULT_PHOTO;
      if (dropzonePreview) dropzonePreview.classList.add('hidden');
      if (dropzoneIdle) dropzoneIdle.classList.remove('hidden');
      photoFileInput.value = '';
      if (previewImgElement) previewImgElement.src = DEFAULT_PHOTO;
      if (previewCaptionText) {
        previewCaptionText.innerHTML = '&ldquo;Zero studying, maximum conversation &bull; Kumuda &amp; Omana&rdquo;';
      }
      if (previewAuthorText) previewAuthorText.textContent = 'Omana • Best Friend';
      if (previewTagPill) previewTagPill.textContent = 'Study & Nonstop Talking';
    });

    // 5. Load stored polaroids from localStorage on initialization
    try {
      const stored = JSON.parse(localStorage.getItem('vault_user_polaroids') || '[]');
      if (Array.isArray(stored) && stored.length > 0) {
        stored.slice().reverse().forEach(data => {
          const item = createPolaroidElement(data, false);
          polaroidsContainer.prepend(item);
        });
      }
    } catch (err) {
      console.warn('Could not load stored memories:', err);
    }

    updateWallCount();
  }

  // Toast Notification System
  function showToast(message, type = 'info') {
    let container = document.getElementById('vault-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'vault-toast-container';
      container.className = 'vault-toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `vault-toast toast-${type}`;
    const icon = type === 'success' ? 'check_circle' : (type === 'warning' ? 'warning' : 'info');
    toast.innerHTML = `
      <span class="material-symbols-outlined">${icon}</span>
      <span>${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('show');
    }, 10);

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        toast.remove();
      }, 400);
    }, 3800);
  }

  /**
   * Initialize Everything
   */
  function init() {
    if (video) {
      video.playbackRate = playbackSpeed;
    }
    window.addEventListener('resize', onResize, { passive: true });
    setupNavbar();
    setupTimelineScrubber();
    setupAutoplay();
    setupSpeedButton();
    setupSoundToggle();
    setupReplayButton();
    setupVideoScrollPlayback();
    setupClarityControls();
    setupVaultInteractions();
    setupPhotoUploadStudio();
    preloadImages();
    onResize();
    requestAnimationFrame(animationLoop);
  }

  // DOM Content Loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
