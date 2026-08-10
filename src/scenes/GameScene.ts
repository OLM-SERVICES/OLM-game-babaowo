import Phaser from 'phaser'
import { CasinoBridge } from '../bridge'
import type { BetResult } from '../bridge'

const BALL_COUNT  = 90
const MIN_PICKS   = 2
const MAX_PICKS   = 5
const DRAW_COUNT  = 5
// Matches OLM-Casino-Backend's services/games/babaOwo.js multiplierFor() at
// its DEFAULT_EDGE (0.20): pick 2 is priced from true hypergeometric
// probability (320.40×); picks 3-5's true odds are so long that the correct
// price is capped at MAX_MULTIPLIER_CEILING (3000×) regardless — see that
// file's header comment for why. This table used to say
// {2:217, 3:400, 4:900, 5:2500} — the old unpriced values that same header
// comment documents replacing (they implied house edges up to 99.99%, and
// picks 4/5 were effectively unwinnable at those prices). Static on
// purpose (this canvas has no live connection to admin-configured edge),
// so it only drifts again if BABA_OWO's edge is ever changed in admin from
// its current default.
const PAYOUT_TABLE: Record<number, number> = { 2: 320.40, 3: 3000, 4: 3000, 5: 3000 }

export class GameScene extends Phaser.Scene {
  private bridge!: CasinoBridge
  private PARENT_ORIGIN: string = '*'

  private selectedBalls: number[] = []
  private currentBalance: number = 0
  private playerPicks: number[] = []
  private isPlacing: boolean = false

  private ballCircles: Map<number, Phaser.GameObjects.Graphics> = new Map()
  private ballTexts:   Map<number, Phaser.GameObjects.Text>     = new Map()
  private ballGlows:   Map<number, Phaser.GameObjects.Graphics> = new Map()

  private selectedCountText!: Phaser.GameObjects.Text
  private payoutBadge!:       Phaser.GameObjects.Text
  private payoutBadgeBg!:     Phaser.GameObjects.Graphics
  private confirmBtn!:        Phaser.GameObjects.Graphics
  private confirmBtnText!:    Phaser.GameObjects.Text
  private confirmBtnHit!:     Phaser.GameObjects.Rectangle
  private confirmVisible: boolean = false

  private btnY: number = 0
  private cx:   number = 0
  private W:    number = 0
  private badgeY: number = 0

  private ballSize:   number = 28
  private ballGap:    number = 3
  private gridStartX: number = 0
  private gridStartY: number = 0
  private cols:       number = 9

  private drumContainer!: Phaser.GameObjects.Container
  private drumBody!:      Phaser.GameObjects.Graphics
  private drumGlow!:      Phaser.GameObjects.Graphics
  private drumLabel!:     Phaser.GameObjects.Text
  private drumSound:      Phaser.Sound.BaseSound | null = null
  private messageHandler: ((event: MessageEvent) => void) | null = null

  private revealSlots:      Phaser.GameObjects.Graphics[] = []
  private revealTexts:      Phaser.GameObjects.Text[]     = []
  private revealContainer!: Phaser.GameObjects.Container

  private overlay!:        Phaser.GameObjects.Graphics
  private overlayText!:    Phaser.GameObjects.Text
  private overlaySubText!: Phaser.GameObjects.Text

  private bgGradient!: Phaser.GameObjects.Graphics
  private aurora1!:    Phaser.GameObjects.Graphics
  private aurora2!:    Phaser.GameObjects.Graphics
  private auroraTime:  number = 0

  private gridContainer!: Phaser.GameObjects.Container

  // Layout lifecycle: tracks whether setupUI() has run at least once, so
  // we know whether there's an existing UI to tear down before rebuilding.
  private uiInitialized: boolean = false
  private resizeTimer: Phaser.Time.TimerEvent | null = null

  constructor() { super('GameScene') }

  preload() {
    this.load.audio('background', '/sounds/background-babaowo.mp3')
    this.load.audio('select',     '/sounds/select-babaowo.mp3')
    this.load.audio('confirm',    '/sounds/click-babaowo.mp3')
    this.load.audio('drum',       '/sounds/drum-babaowo.mp3')
    this.load.audio('ball_drop',  '/sounds/ball_drop-babaowo.mp3')
    this.load.audio('win',        '/sounds/win-babaowo.mp3')
    this.load.audio('loss',       '/sounds/loss-babaowo.mp3')
  }

  create() {
    this.sound.pauseOnBlur = false
    this.PARENT_ORIGIN = import.meta.env.VITE_PARENT_ORIGIN || '*'
    this.bridge = new CasinoBridge(this.PARENT_ORIGIN)

    this.bridge.onInit((balance: number) => {
      this.currentBalance = balance
      window.parent.postMessage({ type: 'BALANCE_UPDATE', payload: { balance } }, this.PARENT_ORIGIN)
    })
    this.bridge.onResult((result: BetResult) => { this.handleResult(result) })
    this.bridge.onErr((message: string)       => { this.handleError(message)  })

    if (this.messageHandler) window.removeEventListener('message', this.messageHandler)
    this.messageHandler = (event: MessageEvent) => {
      if (this.PARENT_ORIGIN !== '*' && event.origin !== this.PARENT_ORIGIN) return
      const { type, payload } = event.data || {}
      if (type === 'PLACE_BET') {
        if (this.isPlacing) return
        this.playerPicks = payload.picks ?? [...this.selectedBalls]
        this.startDrumPhase()
        const clientSeed = Math.random().toString(36).substring(2)
        this.bridge.placeBet({
          game: 'BABA_OWO',
          stake: payload.stake,
          gameParams: { playerPicks: this.playerPicks },
          clientSeed,
        })
      }
    }
    window.addEventListener('message', this.messageHandler)

    this.time.delayedCall(300, () => {
      const ctx = (this.sound as any).context
      if (ctx) {
        ctx.resume()
          .then(() => this.sound.play('background', { loop: true, volume: 0.12 }))
          .catch(() => this.sound.play('background', { loop: true, volume: 0.12 }))
      } else {
        this.sound.play('background', { loop: true, volume: 0.12 })
      }
    })

    // ── Resize-aware layout ─────────────────────────────────────────────
    // Mobile browsers frequently haven't settled their final CSS viewport
    // size (address bar collapse, iframe/webview layout timing) at the
    // instant `create()` fires. setupUI() bakes every position in as fixed
    // pixels computed from the canvas size *at call time*, so if that size
    // is wrong, nothing ever corrects itself — which is why the header,
    // grid, and confirm button can end up overlapping or pushed off-screen
    // on mobile while looking fine on desktop web.
    //
    // Fix: listen for Phaser's scale resize event and rebuild the layout
    // whenever the canvas size actually changes, and also run one safety
    // rebuild shortly after the initial layout to catch cases where the
    // viewport settles a beat after create() runs.
    this.scale.on('resize', this.handleResize, this)

    this.setupUI()

    this.time.delayedCall(300, () => {
      if (!this.isPlacing) this.setupUI()
    })
    this.time.delayedCall(600, () => {
      if (!this.isPlacing) this.setupUI()
    })
  }

  private handleResize() {
    if (this.resizeTimer) {
      this.resizeTimer.remove()
      this.resizeTimer = null
    }
    // Debounce: rapid resize events (rotation, browser chrome animating)
    // shouldn't trigger a rebuild per-frame.
    this.resizeTimer = this.time.delayedCall(120, () => {
      // Don't tear down the drum/reveal UI mid-animation — the next resize
      // after the round finishes will pick up the correct layout instead.
      if (this.isPlacing) return
      this.setupUI()
    })
  }

  // Tears down everything built by setupUI() so it can be safely re-run.
  // Only the objects created directly in the scene (not inside
  // gridContainer) need explicit destruction — gridContainer.destroy(true)
  // recursively destroys all of its children (grid, badge, footer, etc).
  private destroyUI() {
    if (!this.uiInitialized) return
    this.bgGradient?.destroy()
    this.aurora1?.destroy()
    this.aurora2?.destroy()
    this.gridContainer?.destroy(true)
    this.drumContainer?.destroy(true)
    this.revealContainer?.destroy(true)
    this.overlay?.destroy()
    this.overlayText?.destroy()
    this.overlaySubText?.destroy()
    this.ballCircles.clear()
    this.ballTexts.clear()
    this.ballGlows.clear()
    // Force a fresh "not shown yet" state so updateSelectionUI() redraws
    // the confirm button instead of assuming it's already visible.
    this.confirmVisible = false
  }

  private setupUI() {
    this.destroyUI()

    // Use the CSS pixel size of the canvas, not Phaser's potentially
    // DPR-scaled internal size. This is what actually matters for layout —
    // Phaser's scale.width/height can be 1.5–2× the real CSS size when
    // setZoom(devicePixelRatio) is active in main.ts, causing content to
    // be positioned far below the visible area on retina/HiDPI displays.
    const canvas  = this.sys.game.canvas
    const W       = canvas.clientWidth  || this.scale.width
    const H       = canvas.clientHeight || this.scale.height
    const cx      = W / 2
    this.W  = W
    this.cx = cx

    this.bgGradient = this.add.graphics()
    this.drawBgGradient(W, H)
    this.aurora1 = this.add.graphics()
    this.aurora2 = this.add.graphics()
    this.gridContainer = this.add.container(0, 0)

    // ── LAYOUT: proportional to canvas height, grid fills the middle ───
    //
    // Previously header/footer were fixed pixel constants (TITLE_Y=20,
    // HEADER_END=96, BTN_H=44, etc). Those numbers were tuned for a
    // ~900px-tall desktop canvas. On a ~650px mobile canvas they ate a
    // much bigger share of the screen, which is why the payout badge
    // overlapped the grid on desktop-ish widths and the confirm button
    // rendered below the visible viewport on mobile. Everything below
    // now scales with H (with min/max clamps) instead.

    const TITLE_Y    = Math.round(H * 0.028)
    const SUBTITLE_Y = TITLE_Y + Math.round(H * 0.045)
    const BADGE_Y    = SUBTITLE_Y + Math.round(H * 0.028)
    const BADGE_H = 22
    const HEADER_END = BADGE_Y + BADGE_H / 2 + Math.max(28, Math.round(H * 0.045))
    this.badgeY = BADGE_Y

    // ── Grid size: driven by WIDTH first ────────────────────────────────
    // On narrow phones, 9 columns force small balls well before height
    // becomes the limiting factor. The old code sized the grid off
    // available *height* (as if it would fill down to a bottom-anchored
    // footer), then separately capped ball size by width — so on a
    // width-constrained phone the grid rendered small, but the footer
    // stayed pinned far below it, leaving a dead gap and pushing the
    // confirm button toward (or past) the bottom of the screen.
    //
    // Fix: figure out the actual ball size from width, then figure out
    // where the grid actually ends, then place the footer directly below
    // that — instead of the other way around.
    this.cols = 9
    const MIN_BALL = 14
    const MIN_GAP  = 2

    const widthBallSize = Math.floor((W - 24) / this.cols) - MIN_GAP
    let ballSize = Math.max(MIN_BALL, Math.min(36, widthBallSize))
    let gap      = Math.max(MIN_GAP, Math.round(ballSize / 9))

    // Fixed vertical overhead below the grid: small breathing gap, the
    // "N selected" label, a gap, the confirm button, and bottom margin.
    const BTN_H        = Math.max(38, Math.min(48, Math.round(H * 0.06)))
    const BTN_MARGIN_B = Math.max(6, Math.round(H * 0.01))
    const COUNT_H      = Math.max(16, Math.round(H * 0.022))
    const GRID_TO_COUNT_GAP = Math.max(10, Math.round(H * 0.012))
    const COUNT_TO_BTN_GAP  = 8

    const footerOverhead = GRID_TO_COUNT_GAP + COUNT_H + COUNT_TO_BTN_GAP + BTN_H + BTN_MARGIN_B

    // If the width-driven ball size would make the grid taller than the
    // remaining space, shrink it further (rare — only on very short/wide
    // canvases) so the footer never gets pushed off screen.
    const availForGrid = H - HEADER_END - footerOverhead
    const rowH          = Math.floor(availForGrid / 10)
    if (rowH < ballSize + gap) {
      ballSize = Math.max(MIN_BALL, Math.min(ballSize, rowH - MIN_GAP))
      gap      = Math.max(MIN_GAP, Math.round(ballSize / 9))
    }

    this.ballGap  = gap
    this.ballSize = ballSize
    this.gridStartY = HEADER_END

    // Actual bottom edge of the ball grid, based on the real ball size.
    const gridActualHeight = 9 * (this.ballSize + this.ballGap) + this.ballSize
    const gridBottomActual = this.gridStartY + gridActualHeight

    // Footer sits right after the grid, not pinned to the canvas bottom —
    // this is what removes the dead space. It's still clamped so the
    // button never renders below the visible canvas on tall grids.
    const countY = Math.min(
      gridBottomActual + GRID_TO_COUNT_GAP + COUNT_H / 2,
      H - BTN_MARGIN_B - BTN_H - COUNT_TO_BTN_GAP - COUNT_H / 2
    )
    this.btnY = Math.min(
      countY + COUNT_H / 2 + COUNT_TO_BTN_GAP + BTN_H / 2,
      H - BTN_MARGIN_B - BTN_H / 2
    )

    const totalGridW = this.cols * (this.ballSize + this.ballGap) - this.ballGap
    this.gridStartX  = (W - totalGridW) / 2 + this.ballSize / 2
    // ── Title ──────────────────────────────────────────────────────────
    const titleSize = Math.round(Math.min(W * 0.072, 28))

    this.gridContainer.add(
      this.add.text(cx, TITLE_Y, 'BABA OWO', {
        fontSize: `${titleSize}px`, fontStyle: 'bold',
        fontFamily: 'Georgia, serif', color: '#16A03A',
      }).setOrigin(0.5).setAlpha(0.4).setScale(1.05)
    )
    this.gridContainer.add(
      this.add.text(cx, TITLE_Y, 'BABA OWO', {
        fontSize: `${titleSize}px`, fontStyle: 'bold',
        fontFamily: 'Georgia, serif', color: '#FFD700',
        stroke: '#16A03A', strokeThickness: 2,
      }).setOrigin(0.5)
    )

    // Subtitle — fixed Y, never overlaps title
    const subSize = Math.round(Math.min(W * 0.028, 12))
    this.gridContainer.add(
      this.add.text(cx, SUBTITLE_Y, '🔥 Pick your numbers. Dare the draw.', {
        fontSize: `${subSize}px`, fontFamily: 'Arial, sans-serif', color: '#cfead0',
      }).setOrigin(0.5)
    )

    // Badge — fixed Y, never overlaps subtitle
    this.payoutBadgeBg = this.add.graphics()
    this.payoutBadge   = this.add.text(cx, BADGE_Y, '217× · pick 2 numbers', {
      fontSize: `${Math.round(subSize * 1.05)}px`, fontStyle: 'bold',
      fontFamily: 'Arial, sans-serif', color: '#FFD700',
    }).setOrigin(0.5)
    this.drawPayoutBadgeBg(BADGE_Y)
    this.gridContainer.add(this.payoutBadgeBg)
    this.gridContainer.add(this.payoutBadge)

    // ── Ball grid ──────────────────────────────────────────────────────
    this.ballCircles.clear()
    this.ballTexts.clear()
    this.ballGlows.clear()
    const fontSize = Math.max(7, Math.round(this.ballSize * 0.34))

    for (let i = 0; i < BALL_COUNT; i++) {
      const num = i + 1
      const col = i % this.cols
      const row = Math.floor(i / this.cols)
      const bx  = this.gridStartX + col * (this.ballSize + this.ballGap)
      const by  = this.gridStartY + row * (this.ballSize + this.ballGap)
      const r   = this.ballSize / 2

      const glow = this.add.graphics().setVisible(false)
      this.gridContainer.add(glow)
      this.ballGlows.set(num, glow)

      const ballGfx = this.add.graphics()
      this.drawLotteryBall(ballGfx, bx, by, r, false)
      this.gridContainer.add(ballGfx)

      const txt = this.add.text(bx, by, String(num), {
        fontSize: `${fontSize}px`, fontFamily: 'Arial, sans-serif',
        fontStyle: 'bold', color: '#b8ffcc', resolution: 2,
      }).setOrigin(0.5)
      this.gridContainer.add(txt)

      const hit = this.add.rectangle(bx, by, this.ballSize, this.ballSize)
        .setInteractive({ useHandCursor: true })
      this.gridContainer.add(hit)
      hit.on('pointerdown', () => { if (!this.isPlacing) this.toggleBall(num) })

      this.ballCircles.set(num, ballGfx)
      this.ballTexts.set(num, txt)
    }

    // ── Footer: count label ────────────────────────────────────────────
    this.selectedCountText = this.add.text(cx, countY, 'Select 2–5 lucky numbers', {
      fontSize: `${Math.round(subSize * 1.1)}px`,
      fontFamily: 'Arial, sans-serif', color: '#cfead0',
    }).setOrigin(0.5)
    this.gridContainer.add(this.selectedCountText)

    // ── Footer: confirm button — always within canvas bounds ───────────
    this.confirmBtn = this.add.graphics()
    this.drawConfirmBtn(false)
    this.gridContainer.add(this.confirmBtn)

    this.confirmBtnText = this.add.text(cx, this.btnY, 'CONFIRM PICKS', {
      fontSize: `${Math.round(subSize * 1.2)}px`, fontStyle: 'bold',
      fontFamily: 'Arial, sans-serif', color: '#0a1f0a',
    }).setOrigin(0.5).setVisible(false)
    this.gridContainer.add(this.confirmBtnText)

    this.confirmBtnHit = this.add.rectangle(cx, this.btnY, W - 48, BTN_H)
      .setInteractive({ useHandCursor: true }).setVisible(false)
    this.gridContainer.add(this.confirmBtnHit)

    this.confirmBtnHit.on('pointerdown', () => {
      if (this.selectedBalls.length < MIN_PICKS) return
      this.sound.play('confirm', { volume: 0.7 })
      window.parent.postMessage(
        { type: 'PICK_SELECTED', payload: { picks: [...this.selectedBalls] } },
        this.PARENT_ORIGIN
      )
    })

    // ── Drum container ─────────────────────────────────────────────────
    this.drumContainer = this.add.container(cx, H * 0.44).setVisible(false).setDepth(5)
    this.drumGlow  = this.add.graphics()
    this.drumBody  = this.add.graphics()
    this.drumLabel = this.add.text(0, 110, 'Drawing numbers...', {
      fontSize: '15px', fontStyle: 'bold',
      fontFamily: 'Arial, sans-serif', color: '#FFD700',
    }).setOrigin(0.5)
    this.drumContainer.add([this.drumGlow, this.drumBody, this.drumLabel])

    this.revealContainer = this.add.container(0, 0).setVisible(false).setDepth(6)

    this.overlay = this.add.graphics().setVisible(false).setDepth(10)
    this.overlayText = this.add.text(cx, H / 2 - 40, '', {
      fontSize: '48px', fontStyle: 'bold',
      fontFamily: 'Georgia, serif', color: '#FFD700',
    }).setOrigin(0.5).setVisible(false).setDepth(11)
    this.overlaySubText = this.add.text(cx, H / 2 + 24, '', {
      fontSize: '18px', fontFamily: 'Arial, sans-serif', color: '#ffffff',
    }).setOrigin(0.5).setVisible(false).setDepth(11)

    this.uiInitialized = true

    // If this is a rebuild (resize/orientation change) while balls were
    // already selected, redraw those selections and restore the badge /
    // confirm button instead of silently losing them.
    this.reapplySelectionVisuals()
  }

  // Redraws the "selected" look for any numbers already in selectedBalls
  // and refreshes badge/confirm-button state — used after a layout
  // rebuild so an in-progress selection survives a resize.
  private reapplySelectionVisuals() {
    this.selectedBalls.forEach(num => {
      const ballGfx = this.ballCircles.get(num)
      const txt     = this.ballTexts.get(num)
      const glow    = this.ballGlows.get(num)
      if (!ballGfx || !txt || !glow) return

      const r   = this.ballSize / 2
      const col = (num - 1) % this.cols
      const row = Math.floor((num - 1) / this.cols)
      const bx  = this.gridStartX + col * (this.ballSize + this.ballGap)
      const by  = this.gridStartY + row * (this.ballSize + this.ballGap)

      this.drawLotteryBall(ballGfx, bx, by, r, true)
      txt.setColor('#3a2a00')
      glow.clear().setVisible(true)
      glow.fillStyle(0xFFD700, 0.22)
      glow.fillCircle(bx, by, r * 1.75)
      this.tweens.add({ targets: glow, alpha: { from: 0.4, to: 0.12 }, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
    })
    this.updateSelectionUI()
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DRUM PHASE
  // ─────────────────────────────────────────────────────────────────────────
  private startDrumPhase() {
    this.isPlacing = true
    this.gridContainer.setVisible(false)
    this.drumContainer.setVisible(true)

    this.drumGlow.clear()
    this.drumGlow.fillStyle(0xFFD700, 0.18); this.drumGlow.fillCircle(0, 25, 90)
    this.drumGlow.fillStyle(0xFFD700, 0.06); this.drumGlow.fillCircle(0, 25, 130)

    this.drumBody.clear()
    this.drumBody.fillStyle(0x5a3a00, 1);    this.drumBody.fillEllipse(0, 0, 150, 60)
    this.drumBody.fillStyle(0x7a5200, 1);    this.drumBody.fillRect(-75, 0, 150, 50)
    this.drumBody.fillStyle(0x4a2e00, 1);    this.drumBody.fillEllipse(0, 50, 150, 60)
    this.drumBody.fillStyle(0xFFD700, 0.18); this.drumBody.fillEllipse(0, 0, 150, 60)
    this.drumBody.lineStyle(2, 0xB8912A, 0.8)
    for (const s of [-60, -30, 0, 30, 60]) { this.drumBody.lineBetween(s, -30, s, 80) }
    this.drumBody.lineStyle(3, 0xFFD700, 1)
    this.drumBody.strokeEllipse(0, 0, 150, 60)
    this.drumBody.strokeEllipse(0, 50, 150, 60)
    this.drumBody.lineStyle(1, 0xB8912A, 0.4)
    this.drumBody.lineBetween(-75, 0, -75, 50)
    this.drumBody.lineBetween(75, 0, 75, 50)
    this.drumBody.fillStyle(0xFFD700, 1);    this.drumBody.fillCircle(0, 25, 10)
    this.drumBody.fillStyle(0x5a3a00, 1);    this.drumBody.fillCircle(0, 25, 7)
    this.drumBody.fillStyle(0xFFFFFF, 0.07); this.drumBody.fillEllipse(-22, -6, 55, 20)

    this.tweens.add({ targets: this.drumGlow,  alpha: { from: 0.6, to: 1 }, duration: 350, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
    this.tweens.add({ targets: this.drumBody,  angle: { from: -8, to: 8 },  duration: 280, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
    this.tweens.add({ targets: this.drumLabel, alpha: { from: 0.5, to: 1 }, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })

    if (this.drumSound) { try { this.drumSound.stop() } catch (_) {} }
    this.drumSound = this.sound.add('drum')
    this.drumSound.play({ loop: true, volume: 0.5 })
  }

  private stopDrum() {
    if (this.drumSound) { try { this.drumSound.stop() } catch (_) {} this.drumSound = null }
    this.tweens.killTweensOf(this.drumBody)
    this.tweens.killTweensOf(this.drumGlow)
    this.tweens.killTweensOf(this.drumLabel)
    this.drumBody.setAngle(0)
    this.drumContainer.setVisible(false)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RESULT → REVEAL
  // ─────────────────────────────────────────────────────────────────────────
  private handleResult(result: BetResult) {
    const drawn = (result.result as { drawn: number[] }).drawn
    this.currentBalance = result.newBalance
    this.stopDrum()
    this.startRevealPhase(drawn, result)
  }

  private startRevealPhase(drawn: number[], result: BetResult) {
    const canvas = this.sys.game.canvas
    const W      = canvas.clientWidth  || this.scale.width
    const H      = canvas.clientHeight || this.scale.height
    const cx     = W / 2

    this.revealContainer.removeAll(true)
    this.revealContainer.setVisible(true)

    this.revealContainer.add(
      this.add.text(cx, 36, 'DRAWING RESULTS', {
        fontSize: '18px', fontStyle: 'bold',
        fontFamily: 'Georgia, serif', color: '#FFD700',
      }).setOrigin(0.5)
    )
    this.revealContainer.add(
      this.add.text(cx, 62,
        `Your picks: ${[...this.playerPicks].sort((a, b) => a - b).join(' · ')}`,
        { fontSize: '13px', fontFamily: 'Arial, sans-serif', color: '#cfead0' }
      ).setOrigin(0.5)
    )

    const slotSize    = Math.min(Math.floor(W / 6.5), 56)
    const gap         = Math.floor(slotSize * 0.22)
    const totalW      = DRAW_COUNT * slotSize + (DRAW_COUNT - 1) * gap
    const slotsStartX = cx - totalW / 2 + slotSize / 2
    const slotsY      = Math.min(H * 0.44, 230)

    this.revealSlots = []
    this.revealTexts = []

    for (let i = 0; i < DRAW_COUNT; i++) {
      const sx   = slotsStartX + i * (slotSize + gap)
      const slot = this.add.graphics()
      slot.lineStyle(1.5, 0xFFD700, 0.25)
      slot.strokeCircle(sx, slotsY, slotSize / 2)
      this.revealContainer.add(slot)
      this.revealSlots.push(slot)

      const slotTxt = this.add.text(sx, slotsY, '?', {
        fontSize: '14px', fontFamily: 'Arial, sans-serif',
        fontStyle: 'bold', color: '#2a5a30',
      }).setOrigin(0.5)
      this.revealContainer.add(slotTxt)
      this.revealTexts.push(slotTxt)
    }

    drawn.forEach((num, i) => {
      this.time.delayedCall(i * 850, () => {
        this.dropBall(i, num, slotsStartX + i * (slotSize + gap), slotsY, slotSize)
      })
    })
    this.time.delayedCall(DRAW_COUNT * 850 + 700, () => { this.showResultOverlay(result) })
  }

  private dropBall(index: number, num: number, x: number, y: number, size: number) {
    const isMatch = this.playerPicks.includes(num)
    this.sound.play('ball_drop', { volume: 0.6 })
    const r = size / 2
    this.revealSlots[index].clear()

    const shadow = this.add.graphics().setDepth(4)
    shadow.fillStyle(0x000000, 0.30)
    shadow.fillEllipse(x, y + r * 0.65, size * 0.75, size * 0.22)
    this.revealContainer.add(shadow)

    const ballGfx = this.add.graphics().setDepth(5)
    this.revealContainer.add(ballGfx)

    if (isMatch) {
      ballGfx.fillStyle(0x7a5500, 1);    ballGfx.fillCircle(0, 0, r)
      ballGfx.fillStyle(0xFFD700, 1);    ballGfx.fillCircle(0, 0, r * 0.90)
      ballGfx.fillStyle(0xFFFDE0, 0.65); ballGfx.fillCircle(-r * 0.28, -r * 0.30, r * 0.32)
      ballGfx.fillStyle(0xAA8800, 0.25); ballGfx.fillCircle(r * 0.18, r * 0.22, r * 0.35)
      ballGfx.lineStyle(1.5, 0xB8912A, 1); ballGfx.strokeCircle(0, 0, r * 0.90)
    } else {
      ballGfx.fillStyle(0x0d1f10, 1);    ballGfx.fillCircle(0, 0, r)
      ballGfx.fillStyle(0x1a4a22, 1);    ballGfx.fillCircle(0, 0, r * 0.88)
      ballGfx.fillStyle(0xFFFFFF, 0.10); ballGfx.fillCircle(-r * 0.25, -r * 0.28, r * 0.28)
      ballGfx.lineStyle(1, 0x2a7a3a, 1); ballGfx.strokeCircle(0, 0, r * 0.88)
    }
    ballGfx.setPosition(x, y - 160).setAlpha(0)
    shadow.setAlpha(0)

    const numFontSize = Math.max(10, Math.round(size * 0.30))
    const numTxt = this.add.text(x, y - 160, String(num), {
      fontSize: `${numFontSize}px`, fontStyle: 'bold',
      fontFamily: 'Arial, sans-serif',
      color: isMatch ? '#3a2a00' : '#b8ffcc', resolution: 2,
    }).setOrigin(0.5).setAlpha(0).setDepth(6)
    this.revealContainer.add(numTxt)
    this.revealTexts[index].setVisible(false)

    this.tweens.add({ targets: [ballGfx, numTxt], y, alpha: 1, duration: 400, ease: 'Bounce.easeOut' })
    this.tweens.add({ targets: shadow, alpha: 1, duration: 400, ease: 'Bounce.easeOut' })

    if (isMatch) {
      this.tweens.add({ targets: [ballGfx, numTxt], scale: 1.32, duration: 150, yoyo: true, delay: 420, ease: 'Power2' })
      const glow = this.add.graphics().setDepth(7)
      glow.lineStyle(3, 0xFFD700, 0.9); glow.strokeCircle(x, y, r)
      this.revealContainer.add(glow)
      this.tweens.add({ targets: glow, scaleX: 1.8, scaleY: 1.8, alpha: 0, duration: 550, delay: 420, ease: 'Power2', onComplete: () => glow.destroy() })
      for (let s = 0; s < 8; s++) {
        const spark = this.add.graphics().setDepth(7)
        spark.fillStyle(0xFFD700, 1); spark.fillCircle(0, 0, 2)
        spark.setPosition(x, y)
        const angle = (s / 8) * Math.PI * 2
        this.tweens.add({ targets: spark, x: x + Math.cos(angle) * 38, y: y + Math.sin(angle) * 38, alpha: 0, duration: 460, delay: 430, ease: 'Power2', onComplete: () => spark.destroy() })
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // OVERLAY
  // ─────────────────────────────────────────────────────────────────────────
  private showResultOverlay(result: BetResult) {
    const canvas = this.sys.game.canvas
    const W      = canvas.clientWidth  || this.scale.width
    const H      = canvas.clientHeight || this.scale.height
    const cx     = W / 2

    this.overlay.clear()
    this.overlay.fillStyle(result.win ? 0x041a04 : 0x1a0000, 0.93)
    this.overlay.fillRect(0, 0, W, H)
    this.overlay.setVisible(true)

    this.overlayText
      .setText(result.win ? '🏆 WINNER!' : 'MISSED')
      .setColor(result.win ? '#FFD700' : '#FF3A2D')
      .setVisible(true).setScale(0.5).setAlpha(1)
    this.tweens.add({ targets: this.overlayText, scale: 1, duration: 300, ease: 'Back.easeOut' })

    this.overlaySubText
      .setText(result.win ? `₦${result.payout.toLocaleString()} won!` : 'Better luck next time')
      .setVisible(true).setAlpha(0)
    this.tweens.add({ targets: this.overlaySubText, alpha: 1, duration: 400, delay: 250 })

    if (result.win) {
      this.sound.play('win', { volume: 0.8 })
      for (let i = 0; i < 55; i++) {
        const p = this.add.graphics().setDepth(12)
        const colors = [0xFFD700, 0x16A03A, 0x00E676, 0xFFFFFF, 0xB8912A]
        p.fillStyle(colors[Math.floor(Math.random() * colors.length)], 1)
        p.fillCircle(0, 0, 3 + Math.random() * 4)
        p.setPosition(cx, H * 0.4)
        const angle = Math.random() * Math.PI * 2
        const dist  = 80 + Math.random() * 250
        this.tweens.add({ targets: p, x: cx + Math.cos(angle) * dist, y: H * 0.4 + Math.sin(angle) * dist, alpha: 0, scale: 0.2, duration: 900 + Math.random() * 600, ease: 'Power2', onComplete: () => p.destroy() })
      }
    } else {
      this.sound.play('loss', { volume: 0.7 })
      this.cameras.main.shake(300, 0.007)
    }

    this.time.delayedCall(result.win ? 3000 : 2200, () => {
      this.tweens.add({
        targets: [this.overlay, this.overlayText, this.overlaySubText],
        alpha: 0, duration: 300,
        onComplete: () => {
          this.overlay.setVisible(false).setAlpha(1)
          this.overlayText.setVisible(false).setAlpha(1)
          this.overlaySubText.setVisible(false).setAlpha(1)
          this.resetToSelection()
        }
      })
    })
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RESET
  // ─────────────────────────────────────────────────────────────────────────
  private resetToSelection() {
    this.revealContainer.removeAll(true)
    this.revealContainer.setVisible(false)
    this.revealSlots = []
    this.revealTexts = []

    this.selectedBalls.forEach(num => {
      const col = (num - 1) % this.cols
      const row = Math.floor((num - 1) / this.cols)
      const bx  = this.gridStartX + col * (this.ballSize + this.ballGap)
      const by  = this.gridStartY + row * (this.ballSize + this.ballGap)
      const ballGfx = this.ballCircles.get(num)
      const txt     = this.ballTexts.get(num)
      const glow    = this.ballGlows.get(num)
      if (ballGfx) this.drawLotteryBall(ballGfx, bx, by, this.ballSize / 2, false)
      if (txt)     txt.setColor('#b8ffcc')
      if (glow)    { this.tweens.killTweensOf(glow); glow.setVisible(false).clear() }
    })

    this.selectedBalls  = []
    this.playerPicks    = []
    this.isPlacing      = false
    this.drumSound      = null
    this.confirmVisible = false
    this.drawConfirmBtn(false)
    this.confirmBtnText.setVisible(false)
    this.confirmBtnHit.setVisible(false)
    this.selectedCountText.setText('Select 2–5 lucky numbers')
    this.payoutBadge.setText('217× · pick 2 numbers')
    this.drawPayoutBadgeBg(this.badgeY)
    this.gridContainer.setVisible(true)

    window.parent.postMessage({ type: 'BET_DONE', payload: { newBalance: this.currentBalance } }, this.PARENT_ORIGIN)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ERROR
  // ─────────────────────────────────────────────────────────────────────────
  private handleError(message: string) {
    this.stopDrum()
    const err = this.add.text(this.scale.width / 2, 60, message, {
      fontSize: '13px', color: '#ff4444',
      backgroundColor: '#1a0000', padding: { x: 12, y: 8 }
    }).setOrigin(0.5).setDepth(20)
    this.time.delayedCall(3000, () => err.destroy())
    this.isPlacing = false
    this.gridContainer.setVisible(true)
    window.parent.postMessage({ type: 'BET_DONE', payload: {} }, this.PARENT_ORIGIN)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TOGGLE BALL
  // ─────────────────────────────────────────────────────────────────────────
  private toggleBall(num: number) {
    const ballGfx = this.ballCircles.get(num)!
    const txt     = this.ballTexts.get(num)!
    const glow    = this.ballGlows.get(num)!
    const r       = this.ballSize / 2
    const col     = (num - 1) % this.cols
    const row     = Math.floor((num - 1) / this.cols)
    const bx      = this.gridStartX + col * (this.ballSize + this.ballGap)
    const by      = this.gridStartY + row * (this.ballSize + this.ballGap)

    if (this.selectedBalls.includes(num)) {
      this.selectedBalls = this.selectedBalls.filter(n => n !== num)
      this.drawLotteryBall(ballGfx, bx, by, r, false)
      txt.setColor('#b8ffcc')
      this.tweens.killTweensOf(glow)
      glow.setVisible(false).clear()
      this.sound.play('select', { volume: 0.4 })
    } else {
      if (this.selectedBalls.length >= MAX_PICKS) return
      this.selectedBalls.push(num)
      this.drawLotteryBall(ballGfx, bx, by, r, true)
      txt.setColor('#3a2a00')
      glow.clear().setVisible(true)
      glow.fillStyle(0xFFD700, 0.22)
      glow.fillCircle(bx, by, r * 1.75)
      this.sound.play('select', { volume: 0.5 })
      this.tweens.add({ targets: [ballGfx, txt], y: '-=3', duration: 100, yoyo: true, ease: 'Back.easeOut' })
      this.tweens.add({ targets: glow, alpha: { from: 0.4, to: 0.12 }, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
    }
    this.updateSelectionUI()
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SELECTION UI
  // ─────────────────────────────────────────────────────────────────────────
  private updateSelectionUI() {
    const count  = this.selectedBalls.length
    const sorted = [...this.selectedBalls].sort((a, b) => a - b)

    if (count === 0) {
      this.selectedCountText.setText('Select 2–5 lucky numbers')
    } else if (count < MIN_PICKS) {
      this.selectedCountText.setText(`${sorted.join(', ')} · pick 1 more to confirm`)
    } else if (count === MAX_PICKS) {
      this.selectedCountText.setText(`${sorted.join(', ')} · max reached`)
    } else {
      this.selectedCountText.setText(`${sorted.join(', ')} ✓ · or add ${MAX_PICKS - count} more`)
    }

    if (count >= MIN_PICKS) {
      this.payoutBadge.setText(`${PAYOUT_TABLE[count]}× payout · ${count} picks`)
    } else {
      this.payoutBadge.setText('217× · pick 2 numbers')
    }
    // Badge text length changes with the pick count ("217× · pick 2
    // numbers" vs "2500× payout · 5 picks") — redraw the pill background
    // every time so it never overlaps or clips the text.
    this.drawPayoutBadgeBg(this.badgeY)

    const shouldShow = count >= MIN_PICKS
    if (shouldShow && !this.confirmVisible) {
      this.confirmVisible = true
      this.drawConfirmBtn(true)
      this.confirmBtnText.setVisible(true)
      this.confirmBtnHit.setVisible(true)
      this.confirmBtnText.setScale(0.8)
      this.tweens.add({ targets: this.confirmBtnText, scale: 1, duration: 200, ease: 'Back.easeOut' })
    } else if (!shouldShow && this.confirmVisible) {
      this.confirmVisible = false
      this.drawConfirmBtn(false)
      this.confirmBtnText.setVisible(false)
      this.confirmBtnHit.setVisible(false)
    }
    if (this.confirmVisible) {
      this.confirmBtnText.setText(`CONFIRM ${count} PICKS · ${PAYOUT_TABLE[count]}×`)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DRAW HELPERS
  // ─────────────────────────────────────────────────────────────────────────
  private drawPayoutBadgeBg(badgeY: number) {
    const pw = (this.payoutBadge.width || 140) + 24
    const ph = 22
    this.payoutBadgeBg.clear()
    this.payoutBadgeBg.fillStyle(0x0f2b12, 0.9)
    this.payoutBadgeBg.lineStyle(1, 0xFFD700, 0.6)
    this.payoutBadgeBg.fillRoundedRect(this.cx - pw / 2, badgeY - ph / 2, pw, ph, 11)
    this.payoutBadgeBg.strokeRoundedRect(this.cx - pw / 2, badgeY - ph / 2, pw, ph, 11)
  }

  private drawBgGradient(W: number, H: number) {
    this.bgGradient.clear()
    const steps = 24
    for (let i = 0; i < steps; i++) {
      const t = i / steps
      const r = Math.round(0x0a + (0x05 - 0x0a) * t)
      const g = Math.round(0x1f + (0x00 - 0x1f) * t)
      const b = Math.round(0x0a + (0x1A - 0x0a) * t)
      this.bgGradient.fillStyle((r << 16) | (g << 8) | b, 1)
      this.bgGradient.fillRect(0, (H / steps) * i, W, H / steps + 1)
    }
  }

  private drawLotteryBall(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, selected: boolean) {
    g.clear()
    if (selected) {
      g.fillStyle(0x7a5500, 1);    g.fillCircle(x, y, r)
      g.fillStyle(0xFFD700, 1);    g.fillCircle(x, y, r * 0.90)
      g.fillStyle(0xFFFDE0, 0.70); g.fillCircle(x - r * 0.28, y - r * 0.30, r * 0.32)
      g.fillStyle(0xAA8800, 0.30); g.fillCircle(x + r * 0.18, y + r * 0.22, r * 0.38)
      g.lineStyle(1.5, 0xB8912A, 1); g.strokeCircle(x, y, r * 0.90)
    } else {
      g.fillStyle(0x061508, 1);    g.fillCircle(x, y, r)
      g.fillStyle(0x0e3317, 1);    g.fillCircle(x, y, r * 0.88)
      g.fillStyle(0x165c28, 1);    g.fillCircle(x, y, r * 0.72)
      g.fillStyle(0xFFFFFF, 0.12); g.fillCircle(x - r * 0.25, y - r * 0.28, r * 0.28)
      g.fillStyle(0xFFD700, 0.08); g.fillCircle(x, y, r * 0.30)
      g.lineStyle(1, 0x2a7a3a, 1); g.strokeCircle(x, y, r * 0.88)
    }
  }

  private drawConfirmBtn(visible: boolean) {
    this.confirmBtn.clear()
    if (!visible) return
    const bw = this.W - 48
    const bh = 44
    this.confirmBtn.fillStyle(0x16A03A, 1)
    this.confirmBtn.fillRoundedRect(this.cx - bw / 2, this.btnY - bh / 2, bw, bh, 10)
    this.confirmBtn.lineStyle(2, 0xFFD700, 1)
    this.confirmBtn.strokeRoundedRect(this.cx - bw / 2, this.btnY - bh / 2, bw, bh, 10)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // UPDATE
  // ─────────────────────────────────────────────────────────────────────────
  update(_time: number, delta: number) {
    this.auroraTime += delta * 0.0003
    const W = this.scale.width
    const H = this.scale.height
    if (!this.aurora1 || !this.aurora2) return
    this.aurora1.clear()
    this.aurora1.fillStyle(0xFFD700, 0.022)
    this.aurora1.fillEllipse(W * 0.2 + Math.sin(this.auroraTime) * 50, H * 0.3 + Math.cos(this.auroraTime * 0.6) * 30, W * 0.8, H * 0.5)
    this.aurora2.clear()
    this.aurora2.fillStyle(0x16A03A, 0.045)
    this.aurora2.fillEllipse(W * 0.8 + Math.cos(this.auroraTime * 0.7) * 40, H * 0.6 + Math.sin(this.auroraTime * 0.5) * 25, W * 0.7, H * 0.4)
  }
}