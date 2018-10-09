'use strict';

const electron = require('electron');
const path = require('path');
const url = require('url');
const ps = require('ps-node');
const dialog = require('electron').dialog;
const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const ipc = electron.ipcMain;
const Tray = electron.Tray;
const Menu = electron.Menu;
const Positioner = require('electron-positioner');
const Storage = require('electron-store');
const settingsStorage = new Storage({"name": "settings"});
const electronLocalshortcut = require('electron-localshortcut');
// var electronIpcLog = require('electron-ipc-log');
//
//
// electronIpcLog(event => {
//   let {channel, data, sent, sync} = event;
//   let args = [sent ? '⬆️' : '⬇️', channel, ...data];
//   if (sync) args.unshift('ipc:sync');
//   else args.unshift('ipc');
//   console.log.apply(console.log, args);
// });
//

const subprocessIds = new Map();
const projectWindows = new Map();
let appIcon = null;
let mainWindow;
let dependencyWizardWindow;
let settingsWindow;
let documentationWindow;
let loggerWindowId;

const debug = /--debug/.test(process.argv[2]);

let frozenAppPath;


let template = [
  {
    label: 'File',
    submenu: [
      {
        label: 'Settings',
        accelerator: 'Shift+CmdOrCtrl+S',
        click: function (menuItem, browserWindow, event) {
          openSettings();
        }
      },
      {
        label: 'Refresh Labels',
        accelerator: 'Shift+CmdOrCtrl+L',
        click: function (menuItem, browserWindow, event) {
          mainWindow.webContents.send("open-refresh-labels");
        }
      },
      {
        label: 'Refresh Projects',
        accelerator: 'Shift+CmdOrCtrl+P',
        click: function (menuItem, browserWindow, event) {
          mainWindow.webContents.send("refreshing-projects", mainWindow.id, subprocessIds, debug);
        }
      },
      {
        label: 'Open First Steps',
        click: function (menuItem, browserWindow, event) {
          startFirstSteps();
        }
      },
      {
        label: 'Open Dependencies Wizard',
        click: function (menuItem, browserWindow, event) {
          startInstallWizard();
        }
      },
      {
        label: 'Verify Schemata',
        accelerator: 'alt+V',
        click: function (menuItem, browserWindow, event) {
          mainWindow.webContents.send("verify-all");
        }
      },

      {
        type: 'separator'
      },
      {
        role: 'quit'
      },
    ]
  },
  {
    role: "editMenu"
  },
  {
    label: 'View',
    submenu: [
      {
        role: 'reload'
      },
      {
        role: 'forcereload'
      },
      {
        label: 'Toggle Full Screen',
        accelerator: (function () {
          if (process.platform === 'darwin') {
            return 'Ctrl+Command+F'
          } else {
            return 'F11'
          }
        })(),
        click: function (item, focusedWindow) {
          if (focusedWindow) {
            focusedWindow.setFullScreen(!focusedWindow.isFullScreen())
          }
        }
      }, {
        label: 'Toggle Developer Tools',
        accelerator: (function () {
          if (process.platform === 'darwin') {
            return 'Alt+Command+I'
          } else {
            return 'Ctrl+Shift+I'
          }
        })(),
        click: function (item, focusedWindow) {
          if (focusedWindow) {
            focusedWindow.toggleDevTools()
          }
        }
      },
      {
        role: 'zoomin'
      },
      {
        role: 'zoomout'
      },
      {
        role: 'resetzoom'
      }
    ]
  }, {
    role: 'windowMenu'
  }, {
    label: 'Help',
    role: 'help',
    submenu: [
      {
        label: 'About',
        click: function () {
          openAbout();
        }
      },
      {
        label: 'Update Gcloud',
        click: function () {
          updateGcloud();
        }
      },
      {
        label: 'Documentation',
        click: function (event) {
          openDocumentation(event, null);
        }
      },
      {
        label: 'ViUR Online Docs',
        click: function () {
          electron.shell.openExternal('https://www.viur.is/')
        }
      },
    ]
  }];

function createWindow() {
  frozenAppPath = process.env["frozenAppPath"] = app.getAppPath();
  console.log("frozenAppPath", frozenAppPath);
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  console.log("user data directory:", app.getPath('userData'));

  app.setName("ViUR control");
  app.setAppUserModelId('com.mausbrand.viur_control');

  const iconName = process.platform === 'win32' ? 'favicon.ico' : 'icon-vc-16.png';
  const iconPath = path.join(frozenAppPath, "assets", "img", iconName);

  // Create the browser window.
  mainWindow = new BrowserWindow(
    {
      width: 1080,
      minWidth: 680,
      height: 840,
      icon: iconPath
    }
  );

  // and load the index.html of the app.
  mainWindow.loadURL(url.format({
    pathname: path.join(frozenAppPath, 'assets/views/index.html'),
    protocol: 'file:',
    slashes: true
  }));

  appIcon = new Tray(iconPath);
  app.isQuitting = false;

  if (debug) {
    mainWindow.webContents.openDevTools();
    mainWindow.maximize();
    require('devtron').install()
  }

  mainWindow.on('closed', function (event) {
    mainWindow = null
  });

  const mainWindowId = mainWindow.id;

  const contextMenu = Menu.buildFromTemplate(
    [
      {
        label: 'Show/Hide ViUR control',
        click: function () {
          mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show()
        }
      },
      {
        label: 'Quit ViUR control',
        click: function () {
          onBeforeQuit();
          stopInstances();
          app.isQuitting = true;
          app.quit();
        }
      }
    ]
  );

  appIcon.setTitle("ViUR control");
  appIcon.setToolTip('ViUR control - The ViUR Server Instance Manager.');
  appIcon.setContextMenu(contextMenu);

  appIcon.on('click', () => {
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show()
  });

  mainWindow.on('show', () => {
    appIcon.setHighlightMode('always')
  });

  mainWindow.on('minimize', () => {
    mainWindow.hide();
  });

  mainWindow.on('before-close', (ev) => {
    ev.preventDefault();
    mainWindow.hide();
    return false;
  });

  mainWindow.on('close', (ev) => {
    if (!app.isQuitting) {
      ev.preventDefault();
      mainWindow.hide();
      return false;
    }
  });

  mainWindow.webContents.on('crashed', function () {
    console.error("mainWindow crashed");
  });

  mainWindow.on('unresponsive', function () {
    console.error("mainWindow is unresponsive");
  });

  electronLocalshortcut.register(mainWindow, 'Alt+1', () => {
    mainWindow.webContents.send("project-pane-selected", 0);
  });

  electronLocalshortcut.register(mainWindow, 'Alt+2', () => {
    mainWindow.webContents.send("project-pane-selected", 1);
  });

  electronLocalshortcut.register(mainWindow, 'Alt+3', () => {
    mainWindow.webContents.send("project-pane-selected", 2);
  });

  mainWindow.webContents.on('did-finish-load', function (event) {
    mainWindow.webContents.send("window-ready", mainWindowId, app.getPath('userData'), debug);
  });

}

function startInstallWizard(event) {
  dependencyWizardWindow = new BrowserWindow({
    icon: path.join(frozenAppPath, 'assets/img/icon-vc-64.png'),
    frame: false,
    width: 900,
    height: 800
  });
  let positioner = new Positioner(dependencyWizardWindow);
  positioner.move('topLeft');
  dependencyWizardWindow.loadURL(url.format({
    pathname: path.join(frozenAppPath, 'assets/views/installWizard.html'),
    protocol: 'file:',
    slashes: true,
    show: false
  }));
  dependencyWizardWindow.on('closed', function (event) {
    dependencyWizardWindow = null
  });
  dependencyWizardWindow.webContents.on('did-finish-load', function () {
    dependencyWizardWindow.show();
    dependencyWizardWindow.webContents.send('start-wizard');
  });
}

function startFirstSteps(event) {
  dependencyWizardWindow = new BrowserWindow({
    title: `ViUR control - first steps`,
    icon: path.join(frozenAppPath, 'assets/img/icon-vc-64.png'),
    frame: false
  });
  let positioner = new Positioner(dependencyWizardWindow);
  positioner.move('bottomLeft');
  dependencyWizardWindow.loadURL(url.format({
    pathname: path.join(frozenAppPath, 'assets/views/firstStart.html'),
    protocol: 'file:',
    slashes: true,
    show: false
  }));
  dependencyWizardWindow.on('closed', function (event) {
    dependencyWizardWindow = null
  });
  dependencyWizardWindow.webContents.on('did-finish-load', function () {
    dependencyWizardWindow.show();
    dependencyWizardWindow.webContents.send("first-start", dependencyWizardWindow.id, debug);
    console.log("after first start event");
  });
}

function openSettings(event) {
  settingsWindow = new BrowserWindow({
    icon: path.join(frozenAppPath, 'assets/img/icon-vc-64.png'),
    frame: false
  });
  settingsWindow.loadURL(url.format({
    pathname: path.join(frozenAppPath, 'assets/views/settings.html'),
    protocol: 'file:',
    slashes: true
  }));
  settingsWindow.on('closed', function (event) {
    settingsWindow = null
  });
  settingsWindow.show();
  settingsWindow.webContents.on('did-finish-load', function () {
    settingsWindow.webContents.send('load-settings');
  });
}

function openDocumentation(event, view) {
  if (!documentationWindow) {
    documentationWindow = new BrowserWindow({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      icon: path.join(frozenAppPath, 'assets/img/icon-vc-64.png'),
      frame: false,
      // parent: mainWindow,
      // modal: true,
      show: false,
      height: 900
    });

    documentationWindow.loadURL(url.format({
      pathname: path.join(frozenAppPath, 'assets/views/documentation.html'),
      protocol: 'file:',
      slashes: true
    }));
    documentationWindow.on('closed', function (event) {
      documentationWindow = null
    });
    let positioner = new Positioner(documentationWindow);
    positioner.move('center');
    documentationWindow.on('closed', function (event) {
      documentationWindow = null
    });
    documentationWindow.webContents.on('did-finish-load', function () {
      documentationWindow.webContents.send('start', view, app.getPath('userData'));
      documentationWindow.show();
    });
  } else {
    documentationWindow.webContents.send('change', view);
  }
}

function openAbout(event) {
  let aboutWindow = new BrowserWindow({
    icon: path.join(frozenAppPath, 'assets/img/icon-vc-64.png'),
    frame: false,
    width: 600,
    height: 450,
    show: false,
  });
  aboutWindow.loadURL(url.format({
    pathname: path.join(frozenAppPath, 'assets/views/about.html'),
    protocol: 'file:',
    slashes: true
  }));
  let positioner = new Positioner(aboutWindow);
  positioner.move('center');
  aboutWindow.on('closed', function (event) {
    aboutWindow = null
  });

  aboutWindow.webContents.on('did-finish-load', function () {
    aboutWindow.show();
  });
}

function updateGcloud(event) {
  let updateWindow = new BrowserWindow({
    icon: path.join(frozenAppPath, 'assets/img/icon-vc-64.png'),
    frame: false,
    width: 600,
    height: 450,
    show: false,
    webPreferences: {
      webSecurity: true
    }
  });
  updateWindow.loadURL(url.format({
    pathname: path.join(frozenAppPath, 'assets/views/taskWindow.html'),
    protocol: 'file:',
    slashes: true
  }));
  let positioner = new Positioner(updateWindow);
  positioner.move('center');
  updateWindow.on('closed', function (event) {
    updateWindow = null
  });

  updateWindow.webContents.on('did-finish-load', function () {
    updateWindow.show();
    updateWindow.webContents.send('request-update-gcloud', mainWindow.id);
  });
}

function onRequestUpdateGcloudResponse(event, success) {
  console.log("onRequestUpdateGcloudResponse", success);
}


function stopInstances(event) {
  for (let pid of subprocessIds.values()) {
    console.log("kill project dev_server", pid);
    ps.kill(pid, function (err) {
      if (err) {
        throw new Error(err);
      }
      else {
        console.log(`Process ${pid} has been killed!`);
      }
    });
  }
  subprocessIds.clear();
  if (loggerWindowId) {
    try {
      BrowserWindow.fromId(loggerWindowId).close();
    } catch (e) {
      console.log(e);
    }
  }
}

app.on('ready', createWindow);


// TODO: two methods - recheck that!!!
// // Quit when all windows are closed.
app.on('window-all-closed', function () {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (appIcon) {
    appIcon.destroy()
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', function () {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) {
    createWindow();
  }
});

ipc.on('remove-tray', function () {
  appIcon.destroy()
});

function onLocalDevServerStarted(event, internalId, processId) {
  subprocessIds.set(internalId, processId);
  console.log('onLocalDevServerStarted', processId, subprocessIds);
}

function onLocalDevServerStopped(event, internalId) {
  console.log('onLocalDevServerStopped', internalId);
  let subprocessId = subprocessIds.get(internalId);
  subprocessIds.delete(internalId);
  projectWindows.delete(internalId);
  ps.kill(subprocessId, function (err) {
    if (err) {
      throw new Error(err);
    }
    else {
      subprocessIds.delete(subprocessId);
      console.log('Process %s has been killed!', subprocessId);
    }
  });
}

function onSelectDirectoryDialog(event, settingsName) {
  console.log("onSelectDirectoryDialog", settingsName);
  dialog.showOpenDialog({
    properties: ['openDirectory']
  }, function (files) {
    if (files) {
      let newDirectoryPath = files[0];
      console.log(`received new directory '${newDirectoryPath}' for ${settingsName}`);
      settingsStorage.set(settingsName, newDirectoryPath);
      event.sender.send(settingsName, newDirectoryPath);
      if (settingsName === "projects_directory") {
        mainWindow.webContents.send("refreshing-projects", mainWindow.id, subprocessIds, debug);
      }
    }
  });
}

function onSelectProjectIconDialog(event, internalId) {
  console.log("onSelectFileDialog", internalId);
  dialog.showOpenDialog({
    properties: ['openFile']
  }, function (files) {
    if (files) {
      let filePath = files[0];
      console.log(`received new icon path '${filePath}' for in project ${internalId}`);
      event.sender.send("project-icon-changed", internalId, filePath);
    }
  });
}

function onOutputColorChanged(event, name, color) {
  console.log("onOutputColorChanged");
  settingsStorage.set(name, color);
}

function onSettingsStringChanged(event, name, value) {
  console.log("onSettingsStringChanged");
  settingsStorage.set(name, value);
  mainWindow.webContents.send("settings-string-changed", name, value);
}

function onBeforeQuit(event) {
  let arr = BrowserWindow.getAllWindows();
  for (let toWindow of arr) {
    toWindow.close();
  }
}

function onOpenDeploymentConfirmationDialog(event, absolutePath, applicationId, version, labelIcon) {
  console.log("open-information-dialog", absolutePath, applicationId, version);
  const options = {
    type: 'warning',
    title: 'Deployment Confirmation',
    message: "You want to deploy the project \n'" + absolutePath + "'\nto '" + applicationId + "'\nwith version '" + version + "'.\n\nIs this correct?",
    buttons: ['Yes', 'No']
  };
  if (labelIcon) {
    options.icon = labelIcon;
  }
  dialog.showMessageBox(options, function (index) {
    event.sender.send('deployment-dialog-answer', index, absolutePath, applicationId, version);
  })
}

function onRequestSubprocessIds() {
  let a = Array.from(subprocessIds.entries());
  let b = Array.from(projectWindows.entries());
  console.log("onRequestSubprocessIds", a, b);
  mainWindow.webContents.send(
    "request-subprocess-ids-response",
    a,
    b
  );
}

function onNewProjectWindow(event, internalId, windowId) {
  projectWindows.set(internalId, windowId);
}

function onSelectLabelIconDialog(event, label) {
  console.log("onSelectFileDialog", label);
  dialog.showOpenDialog({
    properties: ['openFile']
  }, function (files) {
    if (files) {
      let filePath = files[0];
      console.log(`received new label path '${filePath}'`);
      event.sender.send("label-icon-selected", label, filePath);
    }
  });
}

process.on('uncaughtException', (err) => {
  console.error("uncaught Exception found", err)
});


ipc.on("new-project-window", onNewProjectWindow);
ipc.on('local-devserver-started', onLocalDevServerStarted);
ipc.on('local-devserver-stopped', onLocalDevServerStopped);
ipc.on('select-directory-dialog', onSelectDirectoryDialog);
app.on('before-quit', onBeforeQuit);
ipc.on('open-information-dialog', onOpenDeploymentConfirmationDialog);
ipc.on('output-color-changed', onOutputColorChanged);
ipc.on('settings-string-changed', onSettingsStringChanged);
ipc.on('credentials-found', function (event, applicationId, user, password) {
  mainWindow.webContents.send('credentials-found', applicationId, user, password);
});
ipc.on("scan-new-project", function (event, projectName) {
  mainWindow.webContents.send('scan-new-project', projectName);
});
ipc.on("request-documentation", openDocumentation);
ipc.on("request-settings", openSettings);
ipc.on("open-project-icon-dialog", onSelectProjectIconDialog);
ipc.on("request-subprocess-ids", onRequestSubprocessIds);
ipc.on("select-label-icon-dialog", onSelectLabelIconDialog);
ipc.on("request-update-gcloud-response", onRequestUpdateGcloudResponse);
