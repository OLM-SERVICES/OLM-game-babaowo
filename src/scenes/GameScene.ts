import Phaser from 'phaser'
import { CasinoBridge } from '../bridge'
import type { BetResult } from '../bridge'

const BALL_COUNT  = 90
const MIN_PICKS   = 2
const MAX_PICKS   = 5
const DRAW_COUNT  = 5
const PAYOUT_TABLE: Record<number, number> = { 2: 217, 3: 400, 4: 900, 5: 2500 }

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

    this.setupUI()
  }

  private setupUI() {
    const W  = this.scale.width
    const H  = this.scale.height
    const cx = W / 2
    this.W  = W
    this.cx = cx

    this.bgGradient = this.add.graphics()
    this.drawBgGradient(W, H)
    this.aurora1 = this.add.graphics()
    this.aurora2 = this.add.graphics()
    this.gridContainer = this.add.container(0, 0)

    // ── Ball sizing ────────────────────────────────────────────────────
    const gridW   = W * 0.88
    this.cols     = 9
    this.ballGap  = Math.max(2, Math.floor(gridW / (this.cols * 5.5)))
    this.ballSize = Math.min(36, Math.floor((gridW - (this.cols - 1) * this.ballGap) / this.cols))

    // ── FIXED layout — work bottom-up so confirm button is always on screen ──
    //
    // Reserve space from the bottom:
    //   36px  confirm button margin from bottom
    //   40px  confirm button height
    //   28px  count label above button
    //   8px   gap
    // = 112px minimum footer clearance from bottom
    //
    // Then fit header (title + subtitle + badge) at the top.
    // The grid fills whatever remains in between.

    const BTN_H        = 40
    const BTN_MARGIN_B = 8    // tighter bottom margin
    const BTN_MARGIN_T = 6    // tighter gap above button
    const COUNT_H      = 18
    const COUNT_GAP    = 6

     this.btnY = H - BTN_MARGIN_B - BTN_H / 2

    const countY    = this.btnY - BTN_H / 2 - BTN_MARGIN_T - COUNT_H / 2
    const gridBottom = countY - COUNT_GAP

    // Header — fit in whatever space is above the grid
    const rowH      = this.ballSize + this.ballGap
    const gridH     = 10 * rowH
    this.gridStartY = Math.max(gridBottom - gridH, 0)

    // If grid doesn't fit, shrink balls slightly so they all fit
    if (this.gridStartY === 0) {
      const availH    = gridBottom
      const newRowH   = Math.floor(availH / 10)
      this.ballSize   = Math.min(this.ballSize, newRowH - this.ballGap)
      this.gridStartY = 0
    }

    // Header zone — space above grid
    const headerH   = this.gridStartY
    const titleY    = Math.max(12, Math.round(headerH * 0.20))
    const subtitleY = titleY  + Math.round(Math.max(12, this.ballSize * 0.45))
    const badgeY    = subtitleY + Math.round(Math.max(12, this.ballSize * 0.38))

    const totalGridW  = this.cols * (this.ballSize + this.ballGap) - this.ballGap
    this.gridStartX   = (W - totalGridW) / 2 + this.ballSize / 2

    // ── Title ──────────────────────────────────────────────────────────
    const titleSize = Math.round(Math.min(W * 0.072, 28))

    this.gridContainer.add(
      this.add.text(cx, titleY, 'BABA OWO', {
        fontSize: `${titleSize}px`, fontStyle: 'bold',
        fontFamily: 'Georgia, serif', color: '#16A03A',
      }).setOrigin(0.5).setAlpha(0.4).setScale(1.05)
    )
    this.gridContainer.add(
      this.add.text(cx, titleY, 'BABA OWO', {
        fontSize: `${titleSize}px`, fontStyle: 'bold',
        fontFamily: 'Georgia, serif', color: '#FFD700',
        stroke: '#16A03A', strokeThickness: 2,
      }).setOrigin(0.5)
    )

    const subSize = Math.round(Math.min(W * 0.028, 12))
    this.gridContainer.add(
      this.add.text(cx, subtitleY, '🔥 Pick your numbers. Dare the draw.', {
        fontSize: `${subSize}px`, fontFamily: 'Arial, sans-serif', color: '#cfead0',
      }).setOrigin(0.5)
    )

    // ── Payout badge ───────────────────────────────────────────────────
    this.payoutBadgeBg = this.add.graphics()
    this.payoutBadge   = this.add.text(cx, badgeY, '217× · pick 2 numbers', {
      fontSize: `${Math.round(subSize * 1.05)}px`, fontStyle: 'bold',
      fontFamily: 'Arial, sans-serif', color: '#FFD700',
    }).setOrigin(0.5)
    this.drawPayoutBadgeBg(badgeY)
    this.gridContainer.add(this.payoutBadgeBg)
    this.gridContainer.add(this.payoutBadge)

    // ── Ball grid ──────────────────────────────────────────────────────
    this.ballCircles.clear()
    this.ballTexts.clear()
    this.ballGlows.clear()
    const fontSize = Math.max(8, Math.round(this.ballSize * 0.34))

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

    // ── Footer ─────────────────────────────────────────────────────────
    this.selectedCountText = this.add.text(cx, countY, 'Select 2–5 lucky numbers', {
      fontSize: `${Math.round(subSize * 1.1)}px`,
      fontFamily: 'Arial, sans-serif', color: '#cfead0',
    }).setOrigin(0.5)
    this.gridContainer.add(this.selectedCountText)

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
    this.drumContainer = this.add.container(cx, H * 0.42).setVisible(false).setDepth(5)
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
  }

  private startDrumPhase() {
    this.isPlacing = true
    this.gridContainer.setVisible(false)
    this.drumContainer.setVisible(true)

    this.drumGlow.clear()
    this.drumGlow.fillStyle(0xFFD700, 0.18)
    this.drumGlow.fillCircle(0, 25, 90)
    this.drumGlow.fillStyle(0xFFD700, 0.06)
    this.drumGlow.fillCircle(0, 25, 130)

    this.drumBody.clear()
    this.drumBody.fillStyle(0x5a3a00, 1);  this.drumBody.fillEllipse(0, 0, 150, 60)
    this.drumBody.fillStyle(0x7a5200, 1);  this.drumBody.fillRect(-75, 0, 150, 50)
    this.drumBody.fillStyle(0x4a2e00, 1);  this.drumBody.fillEllipse(0, 50, 150, 60)
    this.drumBody.fillStyle(0xFFD700, 0.18); this.drumBody.fillEllipse(0, 0, 150, 60)
    this.drumBody.lineStyle(2, 0xB8912A, 0.8)
    for (const s of [-60, -30, 0, 30, 60]) { this.drumBody.lineBetween(s, -30, s, 80) }
    this.drumBody.lineStyle(3, 0xFFD700, 1)
    this.drumBody.strokeEllipse(0, 0, 150, 60)
    this.drumBody.strokeEllipse(0, 50, 150, 60)
    this.drumBody.lineStyle(1, 0xB8912A, 0.4)
    this.drumBody.lineBetween(-75, 0, -75, 50)
    this.drumBody.lineBetween(75, 0, 75, 50)
    this.drumBody.fillStyle(0xFFD700, 1);   this.drumBody.fillCircle(0, 25, 10)
    this.drumBody.fillStyle(0x5a3a00, 1);   this.drumBody.fillCircle(0, 25, 7)
    this.drumBody.fillStyle(0xFFFFFF, 0.07); this.drumBody.fillEllipse(-22, -6, 55, 20)

    this.tweens.add({ targets: this.drumGlow, alpha: { from: 0.6, to: 1 }, duration: 350, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
    this.tweens.add({ targets: this.drumBody, angle: { from: -8, to: 8 }, duration: 280, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
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

  private handleResult(result: BetResult) {
    const drawn = (result.result as { drawn: number[] }).drawn
    this.currentBalance = result.newBalance
    this.stopDrum()
    this.startRevealPhase(drawn, result)
  }

  private startRevealPhase(drawn: number[], result: BetResult) {
    const W  = this.scale.width
    const H  = this.scale.height
    const cx = W / 2

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
      glow.lineStyle(3, 0xFFD700, 0.9)
      glow.strokeCircle(x, y, r)
      this.revealContainer.add(glow)
      this.tweens.add({ targets: glow, scaleX: 1.8, scaleY: 1.8, alpha: 0, duration: 550, delay: 420, ease: 'Power2', onComplete: () => glow.destroy() })
      for (let s = 0; s < 8; s++) {
        const spark = this.add.graphics().setDepth(7)
        spark.fillStyle(0xFFD700, 1)
        spark.fillCircle(0, 0, 2)
        spark.setPosition(x, y)
        const angle = (s / 8) * Math.PI * 2
        this.tweens.add({ targets: spark, x: x + Math.cos(angle) * 38, y: y + Math.sin(angle) * 38, alpha: 0, duration: 460, delay: 430, ease: 'Power2', onComplete: () => spark.destroy() })
      }
    }
  }

  private showResultOverlay(result: BetResult) {
    const W  = this.scale.width
    const H  = this.scale.height
    const cx = W / 2

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
    this.gridContainer.setVisible(true)

    window.parent.postMessage({ type: 'BET_DONE', payload: { newBalance: this.currentBalance } }, this.PARENT_ORIGIN)
  }

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
    const bh = 40
    this.confirmBtn.fillStyle(0x16A03A, 1)
    this.confirmBtn.fillRoundedRect(this.cx - bw / 2, this.btnY - bh / 2, bw, bh, 10)
    this.confirmBtn.lineStyle(2, 0xFFD700, 1)
    this.confirmBtn.strokeRoundedRect(this.cx - bw / 2, this.btnY - bh / 2, bw, bh, 10)
  }

  update(_time: number, delta: number) {
    this.auroraTime += delta * 0.0003
    const W = this.scale.width
    const H = this.scale.height
    this.aurora1.clear()
    this.aurora1.fillStyle(0xFFD700, 0.022)
    this.aurora1.fillEllipse(W * 0.2 + Math.sin(this.auroraTime) * 50, H * 0.3 + Math.cos(this.auroraTime * 0.6) * 30, W * 0.8, H * 0.5)
    this.aurora2.clear()
    this.aurora2.fillStyle(0x16A03A, 0.045)
    this.aurora2.fillEllipse(W * 0.8 + Math.cos(this.auroraTime * 0.7) * 40, H * 0.6 + Math.sin(this.auroraTime * 0.5) * 25, W * 0.7, H * 0.4)
  }
}