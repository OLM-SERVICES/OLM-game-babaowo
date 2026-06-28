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

  // Ball grid objects
  private ballCircles: Map<number, Phaser.GameObjects.Arc> = new Map()
  private ballTexts: Map<number, Phaser.GameObjects.Text> = new Map()

  // UI objects
  private selectedCountText!: Phaser.GameObjects.Text
  private confirmBtn!: Phaser.GameObjects.Graphics
  private confirmBtnText!: Phaser.GameObjects.Text
  private confirmBtnHit!: Phaser.GameObjects.Rectangle
  private confirmVisible: boolean = false

  // Layout values
  private btnY: number = 0
  private cx: number = 0
  private W: number = 0

  // Grid layout
  private ballSize: number = 28
  private ballGap: number = 4
  private gridStartX: number = 0
  private gridStartY: number = 0
  private cols: number = 9

  // Drum phase
  private drumGraphic!: Phaser.GameObjects.Graphics
  private drumText!: Phaser.GameObjects.Text
  private drumContainer!: Phaser.GameObjects.Container

  // Reveal phase
  private revealSlots: Phaser.GameObjects.Graphics[] = []
  private revealTexts: Phaser.GameObjects.Text[] = []
  private revealContainer!: Phaser.GameObjects.Container

  // Overlay
  private overlay!: Phaser.GameObjects.Graphics
  private overlayText!: Phaser.GameObjects.Text
  private overlaySubText!: Phaser.GameObjects.Text

  // Aurora
  private aurora1!: Phaser.GameObjects.Graphics
  private aurora2!: Phaser.GameObjects.Graphics
  private auroraTime: number = 0

  // Grid container
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

    this.W  = W
    this.cx = cx

    this.cameras.main.setBackgroundColor('#05001A')

    this.aurora1 = this.add.graphics()
    this.aurora2 = this.add.graphics()

    this.gridContainer = this.add.container(0, 0)

    const title = this.add.text(cx, isMobile ? 24 : 32, 'BABA OWO', {
      fontSize: isMobile ? '26px' : '32px',
      fontStyle: 'bold',
      fontFamily: 'Arial, sans-serif',
      color: '#FFD700',
      stroke: '#B8912A',
      strokeThickness: 2,
    }).setOrigin(0.5)
    this.gridContainer.add(title)

    const subtitle = this.add.text(cx, isMobile ? 52 : 66, 'NAP 2 · Pick Your Lucky Numbers', {
      fontSize: isMobile ? '11px' : '13px',
      fontFamily: 'Arial, sans-serif',
      color: '#ffffff',
    }).setOrigin(0.5)
    this.gridContainer.add(subtitle)

    const payoutBadge = this.add.text(cx, isMobile ? 74 : 92, '217× PAYOUT', {
      fontSize: isMobile ? '13px' : '16px',
      fontStyle: 'bold',
      fontFamily: 'Arial, sans-serif',
      color: '#FFD700',
    }).setOrigin(0.5)
    this.gridContainer.add(payoutBadge)

    this.ballSize = isMobile ? 26 : 32
    this.ballGap  = isMobile ? 3 : 5
    this.cols = 9

    const totalGridW = this.cols * (this.ballSize + this.ballGap) - this.ballGap
    this.gridStartX = (W - totalGridW) / 2 + this.ballSize / 2
    this.gridStartY = isMobile ? 100 : 120

    this.ballCircles.clear()
    this.ballTexts.clear()

    for (let i = 0; i < BALL_COUNT; i++) {
      const num = i + 1
      const col = i % this.cols
      const row = Math.floor(i / this.cols)
      const bx  = this.gridStartX + col * (this.ballSize + this.ballGap)
      const by  = this.gridStartY + row * (this.ballSize + this.ballGap)
      const r   = this.ballSize / 2

      const circle = this.add.circle(bx, by, r, 0x1a0a4a)
        .setStrokeStyle(1.5, 0x4B00FF)
      this.gridContainer.add(circle)

      const txt = this.add.text(bx, by, String(num), {
        fontSize: isMobile ? '8px' : '10px',
        fontFamily: 'Arial, sans-serif',
        color: '#aaaaaa',
      }).setOrigin(0.5)
      this.gridContainer.add(txt)

      const hit = this.add.rectangle(bx, by, this.ballSize, this.ballSize)
        .setInteractive({ useHandCursor: true })
      this.gridContainer.add(hit)

      hit.on('pointerdown', () => {
        if (this.isPlacing) return
        this.toggleBall(num)
      })

      this.ballCircles.set(num, circle)
      this.ballTexts.set(num, txt)
    }

    const gridBottom = this.gridStartY + 10 * (this.ballSize + this.ballGap) + 8

    this.selectedCountText = this.add.text(cx, gridBottom, 'Select 2 lucky numbers', {
      fontSize: isMobile ? '12px' : '14px',
      fontFamily: 'Arial, sans-serif',
      color: '#ffffff',
    }).setOrigin(0.5)
    this.gridContainer.add(this.selectedCountText)

    const btnYLocal = gridBottom + (isMobile ? 32 : 40)
    this.btnY = btnYLocal

    this.confirmBtn = this.add.graphics()
    this.drawConfirmBtn(false)
    this.gridContainer.add(this.confirmBtn)

    this.confirmBtnText = this.add.text(cx, btnYLocal, 'CONFIRM PICKS', {
      fontSize: isMobile ? '13px' : '15px',
      fontStyle: 'bold',
      fontFamily: 'Arial, sans-serif',
      color: '#05001A',
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

    this.drumContainer = this.add.container(cx, H * 0.45).setVisible(false)
    this.drumGraphic = this.add.graphics()
    this.drumContainer.add(this.drumGraphic)
    this.drumText = this.add.text(0, 90, 'Drawing numbers...', {
      fontSize: '16px',
      fontFamily: 'Arial, sans-serif',
      color: '#FFD700',
    }).setOrigin(0.5)
    this.drumContainer.add(this.drumText)

    this.revealContainer = this.add.container(0, 0).setVisible(false)

    this.overlay = this.add.graphics().setVisible(false).setDepth(10)
    this.overlayText = this.add.text(cx, H / 2 - 40, '', {
      fontSize: '52px', fontStyle: 'bold',
      fontFamily: 'Arial, sans-serif',
      color: '#FFD700',
    }).setOrigin(0.5).setVisible(false).setDepth(11)
    this.overlaySubText = this.add.text(cx, H / 2 + 24, '', {
      fontSize: '18px',
      fontFamily: 'Arial, sans-serif',
      color: '#ffffff',
    }).setOrigin(0.5).setVisible(false).setDepth(11)
  }

  private drawConfirmBtn(visible: boolean) {
    this.confirmBtn.clear()
    if (!visible) return
    this.confirmBtn.fillStyle(0xFFD700, 1)
    this.confirmBtn.fillRoundedRect(
      this.cx - (this.W - 48) / 2,
      this.btnY - 22,
      this.W - 48,
      44,
      12
    )
  }

  private toggleBall(num: number) {
    const circle = this.ballCircles.get(num)!
    const txt    = this.ballTexts.get(num)!

    if (this.selectedBalls.includes(num)) {
      this.selectedBalls = this.selectedBalls.filter(n => n !== num)
      circle.setFillStyle(0x1a0a4a).setStrokeStyle(1.5, 0x4B00FF)
      txt.setColor('#aaaaaa')
      this.sound.play('select', { volume: 0.4 })
    } else {
      if (this.selectedBalls.length >= SELECTION_LIMIT) {
        const oldest = this.selectedBalls.shift()!
        const oldCircle = this.ballCircles.get(oldest)!
        const oldTxt    = this.ballTexts.get(oldest)!
        oldCircle.setFillStyle(0x1a0a4a).setStrokeStyle(1.5, 0x4B00FF)
        oldTxt.setColor('#aaaaaa')
      }
      this.selectedBalls.push(num)
      circle.setFillStyle(0xFFD700).setStrokeStyle(2, 0xB8912A)
      txt.setColor('#000000')
      this.sound.play('select', { volume: 0.5 })

      this.tweens.add({
        targets: circle,
        scaleX: 1.25, scaleY: 1.25,
        duration: 80, yoyo: true, ease: 'Power1'
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

  private startDrumPhase() {
    this.isPlacing = true
    this.gridContainer.setVisible(false)
    this.drumContainer.setVisible(true)

    this.drumGraphic.clear()
    this.drumGraphic.fillStyle(0x3d1a00, 1)
    this.drumGraphic.fillEllipse(0, 0, 120, 60)
    this.drumGraphic.fillStyle(0x5a2800, 1)
    this.drumGraphic.fillRect(-60, 0, 120, 40)
    this.drumGraphic.fillStyle(0x3d1a00, 1)
    this.drumGraphic.fillEllipse(0, 40, 120, 60)
    this.drumGraphic.lineStyle(3, 0xFFD700, 1)
    this.drumGraphic.strokeEllipse(0, 0, 120, 60)
    this.drumGraphic.strokeEllipse(0, 40, 120, 60)
    this.drumGraphic.lineBetween(-60, 0, -60, 40)
    this.drumGraphic.lineBetween(60, 0, 60, 40)

    this.sound.play('drum', { loop: true, volume: 0.5 })

    this.tweens.add({
      targets: this.drumGraphic,
      scaleX: -1,
      duration: 600,
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
    this.drumContainer.setVisible(false)

    this.startRevealPhase(drawn, result)
  }

  private startRevealPhase(drawn: number[], result: BetResult) {
    const W  = this.scale.width
    const H  = this.scale.height
    const cx = W / 2

    this.revealContainer.setVisible(true)

    const revealTitle = this.add.text(cx, 40, 'DRAWING RESULTS', {
      fontSize: '18px', fontStyle: 'bold',
      fontFamily: 'Arial, sans-serif',
      color: '#FFD700',
    }).setOrigin(0.5)
    this.revealContainer.add(revealTitle)

    const picksLabel = this.add.text(
      cx, 70,
      `Your picks: ${this.playerPicks[0]} & ${this.playerPicks[1]}`,
      { fontSize: '14px', fontFamily: 'Arial, sans-serif', color: '#ffffff' }
    ).setOrigin(0.5)
    this.revealContainer.add(picksLabel)

    const slotSize    = Math.min(W / 7, 60)
    const totalW      = DRAW_COUNT * slotSize + (DRAW_COUNT - 1) * 12
    const slotsStartX = cx - totalW / 2 + slotSize / 2
    const slotsY      = H * 0.45

    this.revealSlots = []
    this.revealTexts = []

    for (let i = 0; i < DRAW_COUNT; i++) {
      const sx = slotsStartX + i * (slotSize + 12)

      const slot = this.add.graphics()
      slot.lineStyle(2, 0x4B00FF, 0.4)
      slot.strokeCircle(sx, slotsY, slotSize / 2)
      this.revealContainer.add(slot)
      this.revealSlots.push(slot)

      const slotTxt = this.add.text(sx, slotsY, '?', {
        fontSize: '16px',
        fontFamily: 'Arial, sans-serif',
        color: '#444444',
      }).setOrigin(0.5)
      this.revealContainer.add(slotTxt)
      this.revealTexts.push(slotTxt)
    }

    drawn.forEach((num, i) => {
      this.time.delayedCall(i * 900, () => {
        this.dropBall(i, num, slotsStartX + i * (slotSize + 12), slotsY, slotSize)
      })
    })

    this.time.delayedCall(DRAW_COUNT * 900 + 600, () => {
      this.showResultOverlay(result)
    })
  }

  private dropBall(
    index: number,
    num: number,
    x: number,
    y: number,
    size: number
  ) {
    const isMatch = this.playerPicks.includes(num)
    this.sound.play('ball_drop', { volume: 0.6 })

    const slot = this.revealSlots[index]
    slot.clear()
    slot.fillStyle(isMatch ? 0xFFD700 : 0x333333, 1)
    slot.fillCircle(x, y, size / 2)
    slot.lineStyle(2, isMatch ? 0xB8912A : 0x555555, 1)
    slot.strokeCircle(x, y, size / 2)

    const txt = this.revealTexts[index]
    txt.setText(String(num))
      .setColor(isMatch ? '#000000' : '#ffffff')
      .setFontSize(size > 40 ? 16 : 13)

    txt.setY(y - 80).setAlpha(0)
    this.tweens.add({
      targets: txt,
      y,
      alpha: 1,
      duration: 300,
      ease: 'Bounce.easeOut'
    })

    if (isMatch) {
      this.tweens.add({
        targets: txt,
        scale: 1.3,
        duration: 150,
        yoyo: true,
        delay: 320,
        ease: 'Power2'
      })
      const glow = this.add.graphics()
      glow.lineStyle(3, 0xFFD700, 0.8)
      glow.strokeCircle(x, y, size / 2)
      this.revealContainer.add(glow)
      this.tweens.add({
        targets: glow,
        scaleX: 1.6, scaleY: 1.6,
        alpha: 0,
        duration: 500,
        delay: 300,
        ease: 'Power2',
        onComplete: () => glow.destroy()
      })
    }
  }

  private showResultOverlay(result: BetResult) {
    const W  = this.scale.width
    const H  = this.scale.height
    const cx = W / 2

    this.overlay.clear()
    this.overlay.fillStyle(result.win ? 0x001a00 : 0x1a0000, 0.92)
    this.overlay.fillRect(0, 0, W, H)
    this.overlay.setVisible(true)

    this.overlayText
      .setText(result.win ? '🎯 WINNER!' : 'MISSED')
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
      for (let i = 0; i < 40; i++) {
        const p = this.add.graphics().setDepth(12)
        const colors = [0xFFD700, 0x00F0FF, 0x00E676, 0xFFFFFF, 0xFF3A2D]
        p.fillStyle(colors[Math.floor(Math.random() * colors.length)], 1)
        p.fillCircle(0, 0, 3 + Math.random() * 4)
        p.setPosition(cx, H * 0.4)
        const angle = Math.random() * Math.PI * 2
        const dist  = 80 + Math.random() * 220
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
      const circle = this.ballCircles.get(num)
      const txt    = this.ballTexts.get(num)
      if (circle) circle.setFillStyle(0x1a0a4a).setStrokeStyle(1.5, 0x4B00FF)
      if (txt) txt.setColor('#aaaaaa')
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
    this.drumContainer.setVisible(false)

    const err = this.add.text(
      this.scale.width / 2, 80, message, {
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
    this.aurora1.fillStyle(0xFFD700, 0.03)
    this.aurora1.fillEllipse(
      W * 0.2 + Math.sin(this.auroraTime) * 50,
      H * 0.3 + Math.cos(this.auroraTime * 0.6) * 30,
      W * 0.8, H * 0.5
    )
    this.aurora2.clear()
    this.aurora2.fillStyle(0x4B00FF, 0.04)
    this.aurora2.fillEllipse(
      W * 0.8 + Math.cos(this.auroraTime * 0.7) * 40,
      H * 0.6 + Math.sin(this.auroraTime * 0.5) * 25,
      W * 0.7, H * 0.4
    )
  }
}