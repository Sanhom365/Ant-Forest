/*
 * @Author: Sanhom365
 * @Date: 2026-08-12 15:30:00
 * @Last Modified by: Sanhom365
 * @Last Modified time: 2026-08-13 10:16:00
 * @Description: 极速逛一逛/好友能量收集脚本 (基于区域图像检测)
 */
let { config: _config } = require('../config.js')(runtime, global)
let singletonRequire = require('../lib/SingletonRequirer.js')(runtime, global)
let automator = singletonRequire('Automator')
let _commonFunctions = singletonRequire('CommonFunction')
let _widgetUtils = singletonRequire('WidgetUtils')
let YoloDetection = singletonRequire('YoloDetectionUtil')
let BaseScanner = require('./BaseScanner.js')

function StrollScanner () {
  BaseScanner.call(this)

  this.init = function (option) {
    option = option || {}
    this.current_time = option.currentTime || 0
    this.increased_energy = option.increasedEnergy || 0
  }

  /**
   * 步骤 1：检测指定的屏幕区域内是否有能量球
   * 仅检查配置的 tree_collect 区域，不进行任何UI控件/保护罩检测
   */
  this.hasEnergyBallInRegion = function () {
    let screen = _commonFunctions.checkCaptureScreenPermission()
    if (!screen) return false

    // 获取配置中的能量球收集区域
    let left = _config.tree_collect_left || 0
    let top = _config.tree_collect_top || 0
    let width = _config.tree_collect_width || _config.device_width
    let height = _config.tree_collect_height || _config.device_height

    if (YoloDetection.enabled) {
      // YOLO 模型识别
      let list = YoloDetection.forward(screen, {
        confidence: _config.yolo_confidence || 0.7,
        filter: (res) => res.label === 'collect' || res.label === 'waterBall'
      })
      if (!list || list.length === 0) return false

      // 过滤出落于指定区域内的能量球
      let valid = list.filter(item => {
        let cx = item.x + item.width / 2
        let cy = item.y + item.height / 2
        return cx >= left && cx <= (left + width) && cy >= top && cy <= (top + height)
      })
      return valid.length > 0
    } else {
      // Hough 霍夫圆检测
      let grayImg = images.grayscale(images.medianBlur(screen, 5))
      let scaleRate = _config.scaleRate || 1
      let circles = images.findCircles(grayImg, {
        param1: _config.hough_param1 || 30,
        param2: _config.hough_param2 || 30,
        minRadius: parseInt((_config.hough_min_radius || 65) * scaleRate),
        maxRadius: parseInt((_config.hough_max_radius || 75) * scaleRate),
        minDst: parseInt((_config.hough_min_dst || 100) * scaleRate)
      })
      grayImg.recycle()

      if (!circles || circles.length === 0) return false

      // 过滤指定区域
      let valid = circles.filter(c => {
        return c.x >= left && c.x <= (left + width) && c.y >= top && c.y <= (top + height)
      })
      return valid.length > 0
    }
  }

  /**
   * 步骤 2：执行收取逻辑
   */
  this.doCollectExecution = function () {
    // 1) 首次收取所有可以收的能量球
    this.collectEnergy(false)

    // 2) 检测是否使用了双击卡
    let isDoubleCard = _config._double_click_card_used || _widgetUtils.checkIsDuplicateCardUsed()
    if (isDoubleCard) {
      sleep(500)
      this.collectEnergy(false)
    }

    // 3) 不管是否使用了双击卡，隔 0.5 秒再收取一次避免漏收
    sleep(500)
    this.collectEnergy(false)
  }

  /**
   * 步骤 3：上划屏幕切换到下一个好友
   */
  this.swipeToNextFriend = function () {
    let randomTop = _config.topRange() || {}
    let randomBottom = _config.bottomRange() || {}

    let startY = randomTop.start || parseInt(_config.device_height * 0.75)
    let endY = randomBottom.end || parseInt(_config.device_height * 0.25)

    automator.randomScrollDown(
      startY,
      startY + 50,
      endY,
      endY + 50
    )
    // 稍微等待滑动动画及界面稳定
    sleep(600)
  }

  /**
   * 核心主循环
   */
  this.start = function () {
    logInfo('开始极速逛一逛收取好友能量...')
    this.collect_any = false

    while (true) {
      // 1. 到达好友森林后，直接检测指定区域内是否有能量球
      let hasBalls = this.hasEnergyBallInRegion()

      if (hasBalls) {
        // 2. 检测到能量球，按规定流程收取
        this.doCollectExecution()
        this.collect_any = true

        // 3. 收集完成后，上划屏幕并循环到下一个好友
        this.swipeToNextFriend()
      } else {
        // 4. 如果指定区域检测不到能量球，退出循环，返回自己森林
        logInfo('指定区域内未检测到可收取能量球，结束逛一逛循环')
        break
      }
    }

    return {
      collectAny: this.collect_any,
      regenerate_stroll_button: false
    }
  }
}

StrollScanner.prototype = Object.create(BaseScanner.prototype)
StrollScanner.prototype.constructor = StrollScanner

module.exports = StrollScanner
