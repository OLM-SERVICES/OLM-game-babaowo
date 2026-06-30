import Phaser from 'phaser'
import { CasinoBridge } from '../bridge'
import type { BetResult } from '../bridge'

const BALL_COUNT = 90
const SELECTION_LIMIT = 2
const DRAW_COUNT = 5

export class GameScene extends Phaser.Scene {
  private bridge!: CasinoBridge
  private PARENT_ORIGIN: string = '*'

  private selectedBalls: number[] = []
  private currentBalance: number = 0
  private playerPicks: number[] = []
  private isPlacing: boolean = false

  private ballCircles: Map<number, Phaser.GameObjects.Graphics> = new Map()
  private ballTexts: Map<number, Phaser.GameObjects.Text> = new Map()
  private ballGlows: Map<number, Phaser.GameObjects.Graphics> = new Map()

  private selectedCountText!: Phaser.GameObjects.Text
  private confirmBtn!: Phaser.GameObjects.Graphics
  private confirmBtnText!: Phaser.GameObjects.Text
  private confirmBtnHit!: Phaser.GameObjects.Rectangle
  private confirmVisible: boolean = false

  private btnY: number = 0
  private cx: number = 0
  private W: number = 0

  private ballSize: number = 28
  private ballGap: number = 4
  private gridStartX: number = 0
  private gridStartY: number = 0
  private cols: number = 9

  private drumGraphic!: Phaser.GameObjects.Graphics
  private drumText!: Phaser.GameObjects.Text
  private drumContainer!: Phaser.GameObjects.Container
  private drumGlow!: Phaser.GameObjects.Graphics

  private revealSlots: Phaser.GameObjects.Graphics[] = []
  private revealTexts: Phaser.GameObjects.Text[] = []
  private revealContainer!: Phaser.GameObjects.Container

  private overlay!: Phaser.GameObjects.Graphics
  private overlayText!: Phaser.GameObjects.Text
  private overlaySubText!: Phaser.GameObjects.Text

  private bgGradient!: Phaser.GameObjects.Graphics
  private aurora1!: Phaser.GameObjects.Graphics
  private aurora2!: Phaser.GameObjects.Graphics
  private auroraTime: number = 0

  private gridContainer!: Phaser.GameObjects.Container

  constructor() {
    super('GameScene')
  }

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
    this.PARENT_ORIGIN = import.meta.env.VITE_PARENT_ORIGIN || '*'
    this.bridge = new CasinoBridge(this.PARENT_ORIGIN)

    this.bridge.onInit((balance: number) => {
      this.currentBalance = balance
      window.parent.postMessage(
        { type: 'BALANCE_UPDATE', payload: { balance } },
        this.PARENT_ORIGIN
      )
    })

    this.bridge.onResult((result: BetResult) => {
      this.handleResult(result)
    })

    this.bridge.onErr((message: string) => {
      this.handleError(message)
    })

    window.addEventListener('message', (event) => {
      if (this.PARENT_ORIGIN !== '*' && event.origin !== this.PARENT_ORIGIN) return
      const { type, payload } = event.data || {}
      if (type === 'PLACE_BET') {
        this.playerPicks = payload.picks ?? [...this.selectedBalls]
        this.startDrumPhase()
      }
    })

    this.time.delayedCall(300, () => {
      const ctx = (this.sound as any).context
      if (ctx) {
        ctx.resume().then(() => {
          this.sound.play('background', { loop: true, volume: 0.12 })
        }).catch(() => {
          this.sound.play('background', { loop: true, volume: 0.12 })
        })
      } else {
        this.sound.play('background', { loop: true, volume: 0.12 })
      }
    })

    this.setupUI()
    this.scale.on('resize', () => { this.scene.restart() })
  }

  private setupUI() {
    const W = this.scale.width
    const H = this.scale.height
    const cx = W / 2
    const isMobile = W < 500
    const scale = Math.min(1, H / 600)

    this.W  = W
    this.cx = cx

    // ── Deep green-to-black gradient background ───────────────────────
    this.bgGradient = this.add.graphics()
    this.drawBgGradient(W, H)

    this.aurora1 = this.add.graphics()
    this.aurora2 = this.add.graphics()

    this.gridContainer = this.add.container(0, 0)

    // ── Gold/green title treatment ─────────────────────────────────────
    const titleY = Math.round(26 * scale) + 4
    const titleGlow = this.add.text(cx, titleY, 'BABA OWO', {
      fontSize: isMobile ? '28px' : '34px',
      fontStyle: 'bold',
      fontFamily: 'Georgia, serif',
      color: '#16A03A',
    }).setOrigin(0.5).setAlpha(0.35).setScale(1.04)
    this.gridContainer.add(titleGlow)

    const title = this.add.text(cx, titleY, 'BABA OWO', {
      fontSize: isMobile ? '28px' : '34px',
      fontStyle: 'bold',
      fontFamily: 'Georgia, serif',
      color: '#FFD700',
      stroke: '#16A03A',
      strokeThickness: 2,
    }).setOrigin(0.5)
    this.gridContainer.add(title)

    const subtitle = this.add.text(cx, titleY + 26, 'NAP 2 · Pick Your Lucky Numbers', {
      fontSize: isMobile ? '11px' : '13px',
      fontFamily: 'Arial, sans-serif',
      color: '#cfead0',
    }).setOrigin(0.5)
    this.gridContainer.add(subtitle)

    const payoutBg = this.add.graphics()
    const payoutY = titleY + 46
    payoutBg.fillStyle(0x0f2b12, 0.8)
    payoutBg.lineStyle(1, 0xFFD700, 0.5)
    payoutBg.fillRoundedRect(cx - 70, payoutY - 12, 140, 24, 12)
    payoutBg.strokeRoundedRect(cx - 70, payoutY - 12, 140, 24, 12)
    this.gridContainer.add(payoutBg)

    const payoutBadge = this.add.text(cx, payoutY, '217× PAYOUT', {
      fontSize: isMobile ? '12px' : '14px',
      fontStyle: 'bold',
      fontFamily: 'Arial, sans-serif',
      color: '#FFD700',
    }).setOrigin(0.5)
    this.gridContainer.add(payoutBadge)

    // ── Ball grid — lottery-ball style with radial gradient + glow ─────
    this.ballSize = isMobile ? 26 : 30
    this.ballGap  = isMobile ? 4 : 6
    this.cols = 9

    const totalGridW = this.cols * (this.ballSize + this.ballGap) - this.ballGap
    this.gridStartX = (W - totalGridW) / 2 + this.ballSize / 2
    this.gridStartY = payoutY + 26

    this.ballCircles.clear()
    this.ballTexts.clear()
    this.ballGlows.clear()

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
        fontSize: isMobile ? '8px' : '10px',
        fontFamily: 'Arial, sans-serif',
        fontStyle: 'bold',
        color: '#d8d0ff',
      }).setOrigin(0.5)
      this.gridContainer.add(txt)

      const hit = this.add.rectangle(bx, by, this.ballSize + 2, this.ballSize + 2)
        .setInteractive({ useHandCursor: true })
      this.gridContainer.add(hit)

      hit.on('pointerdown', () => {
        if (this.isPlacing) return
        this.toggleBall(num)
      })

      this.ballCircles.set(num, ballGfx)
      this.ballTexts.set(num, txt)
    }

    const gridBottom = this.gridStartY + 10 * (this.ballSize + this.ballGap) + 10

    this.selectedCountText = this.add.text(cx, gridBottom, 'Select 2 lucky numbers', {
      fontSize: isMobile ? '12px' : '14px',
      fontFamily: 'Arial, sans-serif',
      color: '#cfead0',
    }).setOrigin(0.5)
    this.gridContainer.add(this.selectedCountText)

    const btnYLocal = gridBottom + (isMobile ? 30 : 38)
    this.btnY = btnYLocal

    this.confirmBtn = this.add.graphics()
    this.drawConfirmBtn(false)
    this.gridContainer.add(this.confirmBtn)

    this.confirmBtnText = this.add.text(cx, btnYLocal, 'CONFIRM PICKS', {
      fontSize: isMobile ? '13px' : '15px',
      fontStyle: 'bold',
      fontFamily: 'Arial, sans-serif',
      color: '#0a1f0a',
    }).setOrigin(0.5).setVisible(false)
    this.gridContainer.add(this.confirmBtnText)

    this.confirmBtnHit = this.add.rectangle(cx, btnYLocal, W - 48, 44)
      .setInteractive({ useHandCursor: true })
      .setVisible(false)
    this.gridContainer.add(this.confirmBtnHit)

    this.confirmBtnHit.on('pointerdown', () => {
      if (this.selectedBalls.length !== SELECTION_LIMIT) return
      this.sound.play('confirm', { volume: 0.7 })
      window.parent.postMessage(
        { type: 'PICK_SELECTED', payload: { picks: [...this.selectedBalls] } },
        this.PARENT_ORIGIN
      )
    })

    // ── Drum — golden vault-wheel style ─────────────────────────────────
    this.drumContainer = this.add.container(cx, H * 0.42).setVisible(false)
    this.drumGlow = this.add.graphics()
    this.drumContainer.add(this.drumGlow)
    this.drumGraphic = this.add.graphics()
    this.drumContainer.add(this.drumGraphic)
    this.drumText = this.add.text(0, 100, 'Drawing numbers...', {
      fontSize: '16px',
      fontFamily: 'Arial, sans-serif',
      fontStyle: 'bold',
      color: '#FFD700',
    }).setOrigin(0.5)
    this.drumContainer.add(this.drumText)

    this.revealContainer = this.add.container(0, 0).setVisible(false)

    this.overlay = this.add.graphics().setVisible(false).setDepth(10)
    this.overlayText = this.add.text(cx, H / 2 - 40, '', {
      fontSize: '48px', fontStyle: 'bold',
      fontFamily: 'Georgia, serif',
      color: '#FFD700',
    }).setOrigin(0.5).setVisible(false).setDepth(11)
    this.overlaySubText = this.add.text(cx, H / 2 + 24, '', {
      fontSize: '18px',
      fontFamily: 'Arial, sans-serif',
      color: '#ffffff',
    }).setOrigin(0.5).setVisible(false).setDepth(11)
  }

  // ── Background: deep forest green → black gradient ──────────────────
  private drawBgGradient(W: number, H: number) {
    this.bgGradient.clear()
    const steps = 24
    for (let i = 0; i < steps; i++) {
      const t = i / steps
      // interpolate #0a1f0a -> #05001A
      const r = Math.round(0x0a + (0x05 - 0x0a) * t)
      const g = Math.round(0x1f + (0x00 - 0x1f) * t)
      const b = Math.round(0x0a + (0x1A - 0x0a) * t)
      const color = (r << 16) | (g << 8) | b
      this.bgGradient.fillStyle(color, 1)
      this.bgGradient.fillRect(0, (H / steps) * i, W, H / steps + 1)
    }
  }

  // ── Lottery ball: radial-gradient look + gold rim + inner glow ──────
  private drawLotteryBall(
    g: Phaser.GameObjects.Graphics,
    x: number, y: number, r: number,
    selected: boolean
  ) {
    g.clear()

    if (selected) {
      // Gold lottery ball
      g.fillStyle(0x3a2a00, 1)
      g.fillCircle(x, y, r)
      g.fillStyle(0xFFD700, 1)
      g.fillCircle(x, y, r * 0.92)
      // Inner highlight (top-left light source)
      g.fillStyle(0xFFF3B0, 0.55)
      g.fillCircle(x - r * 0.3, y - r * 0.35, r * 0.4)
      g.lineStyle(2, 0xB8912A, 1)
      g.strokeCircle(x, y, r)
    } else {
      // Deep purple-green lottery ball
      g.fillStyle(0x0d2b0f, 1)
      g.fillCircle(x, y, r)
      g.fillStyle(0x14401a, 1)
      g.fillCircle(x, y, r * 0.9)
      // subtle inner highlight
      g.fillStyle(0xFFD700, 0.10)
      g.fillCircle(x - r * 0.3, y - r * 0.3, r * 0.35)
      g.lineStyle(1.5, 0x2f7a3a, 0.9)
      g.strokeCircle(x, y, r)
    }
  }

  private drawConfirmBtn(visible: boolean) {
    this.confirmBtn.clear()
    if (!visible) return
    this.confirmBtn.fillStyle(0x16A03A, 1)
    this.confirmBtn.fillRoundedRect(
      this.cx - (this.W - 48) / 2,
      this.btnY - 22,
      this.W - 48,
      44,
      12
    )
    this.confirmBtn.lineStyle(2, 0xFFD700, 1)
    this.confirmBtn.strokeRoundedRect(
      this.cx - (this.W - 48) / 2,
      this.btnY - 22,
      this.W - 48,
      44,
      12
    )
  }

  private toggleBall(num: number) {
    const ballGfx = this.ballCircles.get(num)!
    const txt     = this.ballTexts.get(num)!
    const glow    = this.ballGlows.get(num)!
    const r       = this.ballSize / 2

    const col = (num - 1) % this.cols
    const row = Math.floor((num - 1) / this.cols)
    const bx  = this.gridStartX + col * (this.ballSize + this.ballGap)
    const by  = this.gridStartY + row * (this.ballSize + this.ballGap)

    if (this.selectedBalls.includes(num)) {
      this.selectedBalls = this.selectedBalls.filter(n => n !== num)
      this.drawLotteryBall(ballGfx, bx, by, r, false)
      txt.setColor('#d8d0ff')
      glow.setVisible(false).clear()
      this.sound.play('select', { volume: 0.4 })
    } else {
      if (this.selectedBalls.length >= SELECTION_LIMIT) {
        const oldest = this.selectedBalls.shift()!
        const oldCol = (oldest - 1) % this.cols
        const oldRow = Math.floor((oldest - 1) / this.cols)
        const obx = this.gridStartX + oldCol * (this.ballSize + this.ballGap)
        const oby = this.gridStartY + oldRow * (this.ballSize + this.ballGap)
        const oldGfx = this.ballCircles.get(oldest)!
        const oldTxt = this.ballTexts.get(oldest)!
        const oldGlow = this.ballGlows.get(oldest)!
        this.drawLotteryBall(oldGfx, obx, oby, r, false)
        oldTxt.setColor('#d8d0ff')
        oldGlow.setVisible(false).clear()
      }
      this.selectedBalls.push(num)
      this.drawLotteryBall(ballGfx, bx, by, r, true)
      txt.setColor('#3a2a00')

      // Halo glow behind selected ball
      glow.clear().setVisible(true)
      glow.fillStyle(0xFFD700, 0.25)
      glow.fillCircle(bx, by, r * 1.8)

      this.sound.play('select', { volume: 0.5 })

      // Lift-off bounce
      this.tweens.add({
        targets: [ballGfx, txt],
        y: '-=4',
        duration: 120,
        yoyo: true,
        ease: 'Back.easeOut'
      })
      this.tweens.add({
        targets: glow,
        alpha: { from: 0.45, to: 0.15 },
        duration: 700,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      })
    }

    const count = this.selectedBalls.length
    this.selectedCountText.setText(
      count === 0 ? 'Select 2 lucky numbers' :
      count === 1 ? `Selected: ${this.selectedBalls[0]} · Pick 1 more` :
      `Selected: ${this.selectedBalls[0]} & ${this.selectedBalls[1]} ✓`
    )

    if (count === SELECTION_LIMIT && !this.confirmVisible) {
      this.confirmVisible = true
      this.drawConfirmBtn(true)
      this.confirmBtnText.setVisible(true)
      this.confirmBtnHit.setVisible(true)
      this.confirmBtnText.setScale(0.8)
      this.tweens.add({ targets: this.confirmBtnText, scale: 1, duration: 200, ease: 'Back.easeOut' })
    } else if (count < SELECTION_LIMIT && this.confirmVisible) {
      this.confirmVisible = false
      this.drawConfirmBtn(false)
      this.confirmBtnText.setVisible(false)
      this.confirmBtnHit.setVisible(false)
    }
  }

  // ── Drum phase: golden vault wheel with glow + sparks ────────────────
  private startDrumPhase() {
    this.isPlacing = true
    this.gridContainer.setVisible(false)
    this.drumContainer.setVisible(true)

    this.drumGlow.clear()
    this.drumGlow.fillStyle(0xFFD700, 0.15)
    this.drumGlow.fillCircle(0, 20, 90)
    this.drumGlow.fillStyle(0xFFD700, 0.08)
    this.drumGlow.fillCircle(0, 20, 130)

    this.drumGraphic.clear()
    // Vault body
    this.drumGraphic.fillStyle(0x3d2a00, 1)
    this.drumGraphic.fillEllipse(0, 0, 130, 64)
    this.drumGraphic.fillStyle(0x5a4000, 1)
    this.drumGraphic.fillRect(-65, 0, 130, 42)
    this.drumGraphic.fillStyle(0x3d2a00, 1)
    this.drumGraphic.fillEllipse(0, 42, 130, 64)
    // Gold rim + spokes
    this.drumGraphic.lineStyle(3, 0xFFD700, 1)
    this.drumGraphic.strokeEllipse(0, 0, 130, 64)
    this.drumGraphic.strokeEllipse(0, 42, 130, 64)
    this.drumGraphic.lineBetween(-65, 0, -65, 42)
    this.drumGraphic.lineBetween(65, 0, 65, 42)
    this.drumGraphic.lineBetween(0, -32, 0, 32 + 42)
    this.drumGraphic.lineBetween(-46, -22, -46, 22 + 42)
    this.drumGraphic.lineBetween(46, -22, 46, 22 + 42)
    // Center hub
    this.drumGraphic.fillStyle(0xFFD700, 1)
    this.drumGraphic.fillCircle(0, 21, 8)

    this.sound.play('drum', { loop: true, volume: 0.5 })

    this.tweens.add({
      targets: this.drumGraphic,
      scaleX: -1,
      duration: 550,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    })
    this.tweens.add({
      targets: this.drumGlow,
      alpha: { from: 0.6, to: 1 },
      duration: 500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    })
  }

  private handleResult(result: BetResult) {
    const drawn = (result.result as { drawn: number[] }).drawn
    this.currentBalance = result.newBalance

    const drumSnd = this.sound.get('drum')
    if (drumSnd?.isPlaying) drumSnd.stop()
    this.tweens.killTweensOf(this.drumGraphic)
    this.tweens.killTweensOf(this.drumGlow)
    this.drumContainer.setVisible(false)

    this.startRevealPhase(drawn, result)
  }

  private startRevealPhase(drawn: number[], result: BetResult) {
    const W  = this.scale.width
    const H  = this.scale.height
    const cx = W / 2

    this.revealContainer.setVisible(true)

    const revealTitle = this.add.text(cx, 38, 'DRAWING RESULTS', {
      fontSize: '18px', fontStyle: 'bold',
      fontFamily: 'Georgia, serif',
      color: '#FFD700',
    }).setOrigin(0.5)
    this.revealContainer.add(revealTitle)

    const picksLabel = this.add.text(
      cx, 64,
      `Your picks: ${this.playerPicks[0]} & ${this.playerPicks[1]}`,
      { fontSize: '13px', fontFamily: 'Arial, sans-serif', color: '#cfead0' }
    ).setOrigin(0.5)
    this.revealContainer.add(picksLabel)

    const slotSize    = Math.min(W / 7, 60)
    const totalW      = DRAW_COUNT * slotSize + (DRAW_COUNT - 1) * 12
    const slotsStartX = cx - totalW / 2 + slotSize / 2
    const slotsY      = Math.min(H * 0.42, 220)

    this.revealSlots = []
    this.revealTexts = []

    for (let i = 0; i < DRAW_COUNT; i++) {
      const sx = slotsStartX + i * (slotSize + 12)

      const slot = this.add.graphics()
      slot.lineStyle(2, 0xFFD700, 0.3)
      slot.strokeCircle(sx, slotsY, slotSize / 2)
      this.revealContainer.add(slot)
      this.revealSlots.push(slot)

      const slotTxt = this.add.text(sx, slotsY, '?', {
        fontSize: '16px',
        fontFamily: 'Arial, sans-serif',
        fontStyle: 'bold',
        color: '#3a5a3e',
      }).setOrigin(0.5)
      this.revealContainer.add(slotTxt)
      this.revealTexts.push(slotTxt)
    }

    drawn.forEach((num, i) => {
      this.time.delayedCall(i * 850, () => {
        this.dropBall(i, num, slotsStartX + i * (slotSize + 12), slotsY, slotSize)
      })
    })

    this.time.delayedCall(DRAW_COUNT * 850 + 700, () => {
      this.showResultOverlay(result)
    })
  }

  // ── Dramatic ball drop: gold lottery ball with shadow + bounce ──────
  private dropBall(
    index: number,
    num: number,
    x: number,
    y: number,
    size: number
  ) {
    const isMatch = this.playerPicks.includes(num)
    this.sound.play('ball_drop', { volume: 0.6 })

    const r = size / 2
    const slot = this.revealSlots[index]
    slot.clear()

    // Drop shadow first
    const shadow = this.add.graphics().setDepth(4)
    shadow.fillStyle(0x000000, 0.35)
    shadow.fillEllipse(x, y + r * 0.6, size * 0.8, size * 0.25)
    this.revealContainer.add(shadow)

    // Ball graphic (lottery ball style)
    const ballGfx = this.add.graphics().setDepth(5)
    this.revealContainer.add(ballGfx)

    if (isMatch) {
      ballGfx.fillStyle(0x3a2a00, 1)
      ballGfx.fillCircle(0, 0, r)
      ballGfx.fillStyle(0xFFD700, 1)
      ballGfx.fillCircle(0, 0, r * 0.92)
      ballGfx.fillStyle(0xFFF3B0, 0.55)
      ballGfx.fillCircle(-r * 0.3, -r * 0.35, r * 0.4)
      ballGfx.lineStyle(2, 0xB8912A, 1)
      ballGfx.strokeCircle(0, 0, r)
    } else {
      ballGfx.fillStyle(0x111111, 1)
      ballGfx.fillCircle(0, 0, r)
      ballGfx.fillStyle(0x333333, 1)
      ballGfx.fillCircle(0, 0, r * 0.9)
      ballGfx.fillStyle(0xffffff, 0.12)
      ballGfx.fillCircle(-r * 0.3, -r * 0.3, r * 0.35)
      ballGfx.lineStyle(1.5, 0x555555, 1)
      ballGfx.strokeCircle(0, 0, r)
    }
    ballGfx.setPosition(x, y - 140).setAlpha(0)
    shadow.setAlpha(0)

    const txt = this.revealTexts[index]
    txt.setText(String(num))
      .setColor(isMatch ? '#3a2a00' : '#ffffff')
      .setFontSize(size > 40 ? 16 : 13)
      .setPosition(x, y - 140)
      .setAlpha(0)
      .setDepth(6)

    // Dramatic fall with bounce + shadow grow
    this.tweens.add({
      targets: [ballGfx, txt],
      y,
      alpha: 1,
      duration: 420,
      ease: 'Bounce.easeOut'
    })
    this.tweens.add({
      targets: shadow,
      alpha: 1,
      scaleX: 1,
      duration: 420,
      ease: 'Bounce.easeOut'
    })

    if (isMatch) {
      this.tweens.add({
        targets: [ballGfx, txt],
        scale: 1.35,
        duration: 160,
        yoyo: true,
        delay: 440,
        ease: 'Power2'
      })
      const glow = this.add.graphics().setDepth(7)
      glow.lineStyle(3, 0xFFD700, 0.9)
      glow.strokeCircle(x, y, r)
      this.revealContainer.add(glow)
      this.tweens.add({
        targets: glow,
        scaleX: 1.7, scaleY: 1.7,
        alpha: 0,
        duration: 550,
        delay: 420,
        ease: 'Power2',
        onComplete: () => glow.destroy()
      })
      // Spark burst on match
      for (let s = 0; s < 8; s++) {
        const spark = this.add.graphics().setDepth(7)
        spark.fillStyle(0xFFD700, 1)
        spark.fillCircle(0, 0, 2)
        spark.setPosition(x, y)
        const angle = (s / 8) * Math.PI * 2
        this.tweens.add({
          targets: spark,
          x: x + Math.cos(angle) * 36,
          y: y + Math.sin(angle) * 36,
          alpha: 0,
          duration: 450,
          delay: 440,
          ease: 'Power2',
          onComplete: () => spark.destroy()
        })
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
      .setText(result.win
        ? `₦${result.payout.toLocaleString()} won!`
        : 'Better luck next time')
      .setVisible(true).setAlpha(0)
    this.tweens.add({ targets: this.overlaySubText, alpha: 1, duration: 400, delay: 250 })

    if (result.win) {
      this.sound.play('win', { volume: 0.8 })
      for (let i = 0; i < 50; i++) {
        const p = this.add.graphics().setDepth(12)
        const colors = [0xFFD700, 0x16A03A, 0x00E676, 0xFFFFFF, 0xB8912A]
        p.fillStyle(colors[Math.floor(Math.random() * colors.length)], 1)
        p.fillCircle(0, 0, 3 + Math.random() * 4)
        p.setPosition(cx, H * 0.4)
        const angle = Math.random() * Math.PI * 2
        const dist  = 80 + Math.random() * 240
        this.tweens.add({
          targets: p,
          x: cx + Math.cos(angle) * dist,
          y: H * 0.4 + Math.sin(angle) * dist,
          alpha: 0, scale: 0.2,
          duration: 900 + Math.random() * 600,
          ease: 'Power2',
          onComplete: () => p.destroy()
        })
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
      if (txt) txt.setColor('#d8d0ff')
      if (glow) { this.tweens.killTweensOf(glow); glow.setVisible(false).clear() }
    })

    this.selectedBalls = []
    this.playerPicks = []
    this.isPlacing = false
    this.confirmVisible = false
    this.drawConfirmBtn(false)
    this.confirmBtnText.setVisible(false)
    this.confirmBtnHit.setVisible(false)
    this.selectedCountText.setText('Select 2 lucky numbers')
    this.gridContainer.setVisible(true)

    window.parent.postMessage({
      type: 'BET_DONE',
      payload: { newBalance: this.currentBalance }
    }, this.PARENT_ORIGIN)
  }

  private handleError(message: string) {
    const drumSnd = this.sound.get('drum')
    if (drumSnd?.isPlaying) drumSnd.stop()
    this.tweens.killTweensOf(this.drumGraphic)
    this.tweens.killTweensOf(this.drumGlow)
    this.drumContainer.setVisible(false)

    const err = this.add.text(
      this.scale.width / 2, 60, message, {
        fontSize: '13px', color: '#ff4444',
        backgroundColor: '#1a0000', padding: { x: 12, y: 8 }
      }
    ).setOrigin(0.5).setDepth(20)
    this.time.delayedCall(3000, () => err.destroy())

    this.isPlacing = false
    this.gridContainer.setVisible(true)

    window.parent.postMessage({ type: 'BET_DONE', payload: {} }, this.PARENT_ORIGIN)
  }

  update(_time: number, delta: number) {
    this.auroraTime += delta * 0.0003
    const W = this.scale.width
    const H = this.scale.height
    this.aurora1.clear()
    this.aurora1.fillStyle(0xFFD700, 0.025)
    this.aurora1.fillEllipse(
      W * 0.2 + Math.sin(this.auroraTime) * 50,
      H * 0.3 + Math.cos(this.auroraTime * 0.6) * 30,
      W * 0.8, H * 0.5
    )
    this.aurora2.clear()
    this.aurora2.fillStyle(0x16A03A, 0.05)
    this.aurora2.fillEllipse(
      W * 0.8 + Math.cos(this.auroraTime * 0.7) * 40,
      H * 0.6 + Math.sin(this.auroraTime * 0.5) * 25,
      W * 0.7, H * 0.4
    )
  }
}