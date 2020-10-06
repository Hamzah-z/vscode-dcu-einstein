// @ts-nocheck
const vscode = require('vscode');
const HttpRequest = require('node-fetch');
const crypto = require('crypto')
const fs = require('fs')

let TASKS_CACHE = {}
let LAST_TASK_CACHE_UPDATE;

let SOC_USERNAME;
let SOC_PASSWORD;

let ValidModuleCodes = ["ca114", "ca116", "ca117", "ca146", "ca167", "ca5980", "ca177", "ca216", "ca282", "ca284", "ca247", "ca277", "ca297", "ca267", "ca644", "be115"]

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
*/

async function StartEinstein(context) {
	let GlobalStorage = context.globalState.get('EINSTEIN_AUTH')

	if (!GlobalStorage) {
		AuthenticateUser()
			.then(msg => {

				context.globalState.update('EINSTEIN_AUTH', { "USERNAME": SOC_USERNAME, "PASSWORD": SOC_PASSWORD });

				vscode.window.showInformationMessage(msg);
			})
			.catch((err) => {
				vscode.window.showErrorMessage(err);
				if (err === "Invalid username or password entered.") {
					AuthenticateUser();
				}
			});
	} else {
		SOC_USERNAME = GlobalStorage["USERNAME"]
		SOC_PASSWORD = GlobalStorage["PASSWORD"]
	}
}

async function AuthenticateUser() {
	return new Promise(async (resolve, reject) => {
		let USERNAME = await DisplayInputBox('SoC Username', false)
		let PASSWORD = await DisplayInputBox('SoC Password', true)

		if (!USERNAME || !PASSWORD) reject("Invalid username or password entered.");

		HttpRequest('https://ca000.computing.dcu.ie/einstein/now', {
			headers: {
				'Authorization': `Basic ${Base64Encode(`${USERNAME}:${PASSWORD}`)}`
			}
		})
			.then(res => {
				if (res.status != 200) {
					reject('Failed to authenticate. Invalid username or password.')
				} else {
					SOC_USERNAME = USERNAME
					SOC_PASSWORD = PASSWORD

					resolve('Authenticated. Einstein is now running.')
				}
			});
	})
}

async function HandleFileUpload(context, TaskName, ModuleCode) {
	let File = vscode.window.activeTextEditor.document.fileName

	const ReqFormData = require('form-data');     
	const ReqForm = new ReqFormData();

	ReqForm.append('file', fs.readFileSync(File), {
	  contentType: 'text/plain',
	  name: 'file',
	  filename: TaskName,
	});

	HttpRequest(`https://${ModuleCode}.computing.dcu.ie/einstein/upload`, { 
		method: 'POST', 
		body: ReqForm,
		headers: {
			'Authorization': `Basic ${Base64Encode(`${SOC_USERNAME}:${SOC_PASSWORD}`)}`
		}
	})
	.then(res => {
		if (res.status == 200) {
			res.text()
			.then(OutputText => {
				console.log(OutputText)
	
				let OutputChannel = vscode.window.createOutputChannel(`${TaskName} - Report`)
				OutputChannel.append('REPORT FOR ' + TaskName)
				OutputChannel.append('\n-----------------------------------------------\n')
				OutputChannel.append(OutputText)
				OutputChannel.append(`To view the full report visit: https://${ModuleCode}.computing.dcu.ie/einstein/report.html`)
				OutputChannel.append('\n-----------------------------------------------')
				OutputChannel.show(true)
			
				context.subscriptions.push(OutputChannel)
			})
			.catch((err) => { vscode.window.showErrorMessage(err) });
		} else {
			vscode.window.showErrorMessage('Failed to upload file, Einstein may be down.')
		}
	})
	.catch((err) => { vscode.window.showErrorMessage(err) });
}

async function GatherUploadPrerequisites(context) {

	let DocumentNameData = vscode.window.activeTextEditor.document.fileName.split(`\\`)
	let CurrentTaskName = DocumentNameData[DocumentNameData.length - 1]

	await UpdateTasksCache().catch((err) => { vscode.window.showErrorMessage(err) });

	const SHA1Encoder = crypto.createHash('sha1')
	SHA1Encoder.update(CurrentTaskName)
	let SHA1EncodedTaskName = SHA1Encoder.digest('hex') // => "0beec7b5ea3f0fdbc95d0dd47f3c5bc275da8a33"

	if (SHA1EncodedTaskName in TASKS_CACHE) { 
		let TaskModules = TASKS_CACHE[SHA1EncodedTaskName]
		if (TaskModules.length == 1) { // Only one module uses this task name, carry on with it.
			HandleFileUpload(context, CurrentTaskName, TaskModules[0])
		} else { // If the task exists for more than one module, ask for input.
			let ModuleCode = await DisplayInputBox('Please enter the module code you wish to upload for. This file exists in more than one.', false)
			
			if (!ModuleCode || !ValidModuleCodes.includes(ModuleCode)) {
				vscode.window.showErrorMessage('Invalid module code entered.')
			} else {
				HandleFileUpload(context, CurrentTaskName, ModuleCode)
			}
		}
	} else { vscode.window.showErrorMessage('No such task name found on Einstein. Please ensure your file name is spelled correctly. Ensure you have the text editor selected / in focus.') }
}

async function FetchTasksList() {
    return new Promise(async (resolve, reject) => {
        HttpRequest('https://einstein.computing.dcu.ie/termcast/tasks.txt')
            .then(res => {
                if (res.status != 200) {
                    reject("Failed to fetch tasks.")
                } else {
                    resolve(res)
                }
            });
    })
}

async function UpdateTasksCache() {
	return new Promise((resolve, reject) => {
		const SecondsSinceLastUpdate = (new Date() - LAST_TASK_CACHE_UPDATE) / 1000;
		
		if ((SecondsSinceLastUpdate / 60) < 15) { // Check if it's been 15 minutes since the last update
			resolve(TASKS_CACHE)
			return;
		}

		FetchTasksList()
		.then(raw_tasks => {
			raw_tasks.text()
			.then(tasks => {
				tasks = tasks.split('\n')
				for (let line in tasks) {
					let TaskData = tasks[line].split(' ')
					
					TASKS_CACHE[TaskData[0]] = TaskData.slice(1)
				}

				resolve(TASKS_CACHE)
			})
		})
		.catch((err) => {
			reject(err)
		});
    })
}

//

async function DisplayInputBox(PlaceholderText, IsPassword) {
	let UserInputWindow = await vscode.window.showInputBox({ prompt: PlaceholderText, password: IsPassword });

	return UserInputWindow;
}

function Base64Encode(String) {
	return Buffer.from(String).toString('base64')
}

//

function activate(context) {
	// The command has been defined in the package.json file
	// Now provide the implementation of the command with  registerCommand
	// The commandId parameter must match the command field in package.json

	let EinsteinStartDisp = vscode.commands.registerCommand('vscode-dcu-einstein.Start', () => { StartEinstein(context) })
	let UploadButtonDisp = vscode.commands.registerCommand('vscode-dcu-einstein.Upload', () => { GatherUploadPrerequisites(context) })

	let UploadButton = vscode.window.createStatusBarItem()
	UploadButton.text = `$(arrow-up) Upload to Einstein`;
	UploadButton.tooltip = `Upload currently open file to Einstein.`
	UploadButton.command = 'vscode-dcu-einstein.Upload'
	UploadButton.show()

	context.subscriptions.push(EinsteinStartDisp);
	context.subscriptions.push(UploadButtonDisp);

	UpdateTasksCache()
	.then(() => { LAST_TASK_CACHE_UPDATE = new Date() })
	.catch((err) => { vscode.window.showErrorMessage(err) });
}

exports.activate = activate;

// this method is called when your extension is deactivated
function deactivate() { }

module.exports = {
	activate,
	deactivate
}
