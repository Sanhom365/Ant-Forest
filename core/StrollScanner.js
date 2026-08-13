/*
 * @Author: Sanhom365
 * @Date: 2026-08-12 15:30:00
 * @Last Modified by: Sanhom365
 * @Last Modified time: 2026-08-13 10:44:00/*
 * @Description: 逛一逛极速收集好友能量脚本
 */
let { config: _config } = require('../config.js')(runtime, global)
let singletonRequire = require('../lib/SingletonRequirer.js')(runtime, global)
let _widgetUtils = singletonRequire('WidgetUtils')
let automator = singletonRequire('Automator')
let _commonFunctions = singletonRequire('CommonFunction')
let YoloDetection = singletonRequire('YoloDetectionUtil')
let WarningFloaty = singletonRequire('WarningFloaty')
let BaseScanner = require('./BaseScanner.js')

function StrollScanner() {
  BaseScanner.call(this)

  let self = this
  this.collect_any = false

  this.init = function (option) {
    option = option || {}
    this.current_time = option.currentTime || 0
    this.increased_energy = option.increasedEnergy || 0
    this.group_execute_mode = option.group_execute_mode || false
  }

  this.start = function () {
    debugInfo('开始“逛一逛”极速收取好友能量...')
    return this.strollLoop()
  }

  /**
   * 逛一逛循环主逻辑
   */
  this.strollLoop = function () {
    let strollBtn = this.findStrollButton()
    if (!strollBtn) {
      warnInfo('未找到“逛一逛”按钮，结束逛一逛流程')
      return { collectAny: this.collect_any, regenerate_stroll_button: true }
    }

    // 点击“逛一逛”进入第一个好友森林
    debugInfo('点击“逛一逛”按钮进入好友森林')
    automator.clickCenter(strollBtn)
    sleep(300) // 等待进场动画

    while (true) {
      // 1. 直接检测指定区域内是否有能量球
      let hasBalls = this.checkBallsInRegion()

      // 4. 如果指定的屏幕区域检测不到能量球，退出循环，返回自己的森林
      if (!hasBalls) {
        logInfo('指定区域内未检测到能量球，准备退出逛一逛回到自己森林')
        break
      }

      // 2. 检测到能量球，去收取所有可以收的能量球
      this.collectEnergyPure()

      // 检测是否使用了双击卡
      let isDoubleCard = _widgetUtils.checkIsDuplicateCardUsed() || _config._double_click_card_used
      
      // 隔 0.5 秒再次收取（不管是否用了双击卡，为了避免漏收，再收取一次）
      debugInfo('等待 0.5 秒进行二次补收...')
      sleep(500)
      this.collectEnergyPure()

      this.collect_any = true

      // 3. 收集完成后，上划屏幕切到下一个好友
      debugInfo('当前好友收取完成，划向下一个好友')
      this.swipeToNextFriend()
      sleep(300) // 等待滑动及加载
    }

    return {
      collectAny: this.collect_any
    }
  }

  /**
   * 纯净版收集：直接在配置区域内检测并点击，不包含耗时的控件数据刷新与校验
   */
  this.collectEnergyPure = function () {
    if (YoloDetection.enabled) {
      this.checkAndCollectByYolo(false, null, null, null, 1)
    } else {
      this.checkAndCollectByHough(false, null, null, null, 1)
    }
  }

  /**
   * 极速检查指定区域内是否存在可收取能量球
   */
  this.checkBallsInRegion = function () {
    let screen = _commonFunctions.checkCaptureScreenPermission()
    if (!screen) return false

    if (YoloDetection.enabled) {
      let rgbImg = images.copy(screen, true)
      let yoloCheckList = YoloDetection.forward(rgbImg, {
        confidence: _config.yolo_confidence || 0.85,
        filter: (result) => result.label == 'collect'
      })
      rgbImg.recycle()

      if (!yoloCheckList || yoloCheckList.length === 0) return false

      // 过滤只保留在配置区域内的球
      let validBalls = this.filterCollectableList(yoloCheckList)
      return validBalls.length > 0
    } else {
      // 霍夫圆检测兜底
      let grayImgInfo = images.grayscale(images.medianBlur(screen, 5))
      let findBalls = images.findCircles(grayImgInfo, {
        param1: _config.hough_param1 || 30,
        param2: _config.hough_param2 || 30,
        minRadius: _config.hough_min_radius || parseInt(65 * (_config.scaleRate || 1)),
        maxRadius: _config.hough_max_radius || parseInt(75 * (_config.scaleRate || 1)),
        minDst: _config.hough_min_dst || parseInt(100 * (_config.scaleRate || 1))
      })

      if (!findBalls || findBalls.length === 0) return false

      // 判断是否有在区域内的有效球
      let validCount = 0
      findBalls.forEach(ball => {
        if (
          ball.y >= _config.tree_collect_top &&
          ball.y <= _config.tree_collect_top + _config.tree_collect_height &&
          ball.x >= _config.tree_collect_left &&
          ball.x <= _config.tree_collect_left + _config.tree_collect_width
        ) {
          validCount++
        }
      })
      return validCount > 0
    }
  }

  /**
   * 查找“逛一逛”按钮
   */
  this.findStrollButton = function () {
    let btn = _widgetUtils.widgetGetOne(_config.stroll_button_text || '.*逛一逛.*', 300)
    return btn
  }

  /**
   * 上划屏幕切换到下一个好友
   */
  this.swipeToNextFriend = function () {
    let startX = Math.floor(_config.device_width * 0.5)
    let startY = Math.floor(_config.device_height * 0.6)
    let endY = Math.floor(_config.device_height * 0.2)
    automator.swipe(startX, startY, startX, endY, 300)
  }
}

StrollScanner.prototype = Object.create(BaseScanner.prototype)
StrollScanner.prototype.constructor = StrollScanner

module.exports = StrollScanner
