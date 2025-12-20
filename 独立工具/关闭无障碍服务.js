importClass(java.io.StringWriter)
importClass(java.io.StringReader)
importClass(java.io.PrintWriter)
importClass(java.io.BufferedReader)
importClass(java.lang.StringBuilder)
importClass(android.content.Intent)
importClass(android.view.View)
importClass('org.autojs.autojs.timing.TaskReceiver')
importClass(android.animation.ValueAnimator);
importClass(android.animation.TimeInterpolator);

let { config, storage_name: _storage_name } = require('../config.js')(runtime, global)
let sRequire = require('../lib/SingletonRequirer.js')(runtime, global)

config.save_log_file = false
config.async_save_log_file = false
let commonFunction = sRequire('CommonFunction')
let logUtils = sRequire('LogUtils')
let runningQueueDispatcher = sRequire('RunningQueueDispatcher')
let NotificationHelper = sRequire('Notification')

// 插队运行
runningQueueDispatcher.addRunningTask(true)

let continueRunning = true
let lock = threads.lock()
let complete = lock.newCondition()
lock.lock()
let confirmDialog = dialogs.build({
  title: '是否关闭当前的无障碍服务？',
  content: '当前启用的无障碍服务列表：' + commonFunction.getEnabledAccessibilityServices(),
  positive: '确定',
  positiveColor: '#f9a01c',
  negative: '取消',
  negativeColor: 'red',
  cancelable: false
})
  .on('positive', () => {
    lock.lock()
    try {
      complete.signal()
    } finally {
      lock.unlock()
    }
    confirmDialog.dismiss()
  })
  .on('negative', () => {
    continueRunning = false
    terminate = true
    lock.lock()
    try {
      complete.signal()
    } finally {
      lock.unlock()
    }
    confirmDialog.dismiss()
  })
  .show()
try {
  complete.await()
} finally {
  lock.unlock()
}
if (!continueRunning) {
  runningQueueDispatcher.removeRunningTask()
  exit()
}
// 固定通知ID
const NOTICE_ID = 99113
let waitList = [], loopTime = 0, lastWaitingQueueStr = ''
NotificationHelper.createNotification('挂起脚本并关闭无障碍', '当前无任务等待执行中', NOTICE_ID)
clearA11yService()
commonFunction.registerOnEngineRemoved(function () {
  runningQueueDispatcher.removeRunningTask()
  NotificationHelper.cancelNotice(NOTICE_ID)
  stop = true
})


// 使用线程和缓存机制
threads.start(function () {
  while (!stop) {
    try {
      // 将耗时操作放在线程中执行
      runningQueueDispatcher.renewalRunningTask(null, null, true)
      let waitingQueueStr = runningQueueDispatcher.getStorage().get("waitingQueue") || '[]'
      // 只有数据发生变化时才处理
      if (waitingQueueStr !== lastWaitingQueueStr) {
        lastWaitingQueueStr = waitingQueueStr
        let waitingQueue = []
        try {
          waitingQueue = JSON.parse(waitingQueueStr)
        } catch (e) {
          logUtils.errorInfo('JSON解析等待队列失败:', e)
          waitingQueue = []
        }
        if (waitingQueue && waitingQueue.length > 0) {
          // 更新等待列表
          waitList = waitingQueue.map((task) => task.source)
          let scriptPath = waitingQueue[0].source
          let startScriptIntent = new Intent(context, TaskReceiver)
          startScriptIntent.setAction(new Date().getTime() + '')
          startScriptIntent.putExtra('script', buildScript()) // 使用无参函数
          startScriptIntent.putExtra('triggerByNotice', new Date().getTime() + '')
          NotificationHelper.createNotification(
            '当前等待中任务数：' + waitingQueue.length,
            '点击可以执行第一个任务：' + scriptPath.replace('/storage/emulated/0', '').replace('/sdcard', ''),
            NOTICE_ID, true, startScriptIntent
          )
        } else {
          waitList = []; // 明确清空列表
          NotificationHelper.createNotification('挂起脚本并关闭无障碍', '当前无任务等待执行中', NOTICE_ID)
        }
      }
    } catch (e) {
      logUtils.errorInfo('更新等待队列时出错:' + e)
    }
    // 优化刷新频率逻辑
    let sleepTime;
    if (loopTime > 30) {
      sleepTime = 60000; // 1分钟
    } else if (loopTime > 20) {
      sleepTime = 30000; // 30秒
      loopTime++; // 只在这里增加
    } else {
      sleepTime = 5000; // 5秒
      loopTime++;
    }
    sleep(sleepTime);
  }
})
// keep running
setInterval(() => { 
  runningQueueDispatcher.renewalRunningTask()
}, 15000)

// 生成用于停止当前脚本的代码
function buildScript () { // 移除了未使用的参数
  return `
  engines.all().filter(engine => (engine.getSource() + '').endsWith('关闭无障碍服务.js')).forEach(engine => engine.forceStop());
  `
}
// 关闭无障碍服务
function clearA11yService () {
  let enabledA11yServices = commonFunction.getEnabledAccessibilityServices()
  if (enabledA11yServices) {
    logUtils.infoLog(['当前启用的无障碍服务列表：{}', enabledA11yServices], true)
  } else {
    logUtils.infoLog('当前无启用的无障碍服务', true)
  }
  logUtils.debugInfo('清除无障碍服务')
  // 关闭无障碍 并取消重启
  commonFunction.disableAccessibilityAndRestart(true, true)
  logUtils.debugInfo(['关闭后启用的无障碍服务列表：{}', commonFunction.getEnabledAccessibilityServices()])
}