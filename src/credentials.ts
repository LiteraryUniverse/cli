import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { LiteraryUniverseApiError } from '@literary-universe/sdk'

const service = 'LiteraryUniverse CLI'
// Same canonical form as the SDK's endpoint, so every URL that reaches one
// endpoint selects one keyring account.
const profile = (baseUrl: string) => {
	const url = new URL(baseUrl)
	return createHash('sha256')
		.update(`${url.origin}${url.pathname.replace(/\/+$/, '')}`)
		.digest('hex')
}
const validKey = (value: string) =>
	/^lu_(live|dev|test)_[a-zA-Z0-9_-]+$/.test(value)

function run(command: string, args: string[], input?: string) {
	try {
		return execFileSync(command, args, {
			input,
			encoding: 'utf8',
			stdio: ['pipe', 'pipe', 'pipe'],
			timeout: 5000,
		}).trim()
	} catch {
		throw new LiteraryUniverseApiError(
			'KEYSTORE_UNAVAILABLE',
			'The OS credential store is unavailable or has no key for this deployment. Set LU_TOKEN explicitly or store a key with lu auth store.',
		)
	}
}

const windows = `Add-Type @'
using System; using System.Runtime.InteropServices; using System.Text;
public static class LuCredentials {
[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CREDENTIAL { public uint Flags,Type; public string TargetName,Comment; public long LastWritten; public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist,AttributeCount; public IntPtr Attributes; public string TargetAlias,UserName; }
[DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CredWrite(ref CREDENTIAL c, uint flags);
[DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CredRead(string target, uint type, uint flags, out IntPtr p);
[DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CredDelete(string target, uint type, uint flags);
[DllImport("advapi32.dll")] static extern void CredFree(IntPtr p);
public static string Read(string target) { IntPtr p; if(!CredRead(target,1,0,out p)) throw new Exception("Missing credential"); try { var c=(CREDENTIAL)Marshal.PtrToStructure(p,typeof(CREDENTIAL)); return Marshal.PtrToStringUni(c.CredentialBlob,(int)c.CredentialBlobSize/2); } finally { CredFree(p); } }
public static void Store(string target,string key) { var p=Marshal.StringToCoTaskMemUni(key); try { var c=new CREDENTIAL { Type=1,TargetName=target,UserName=target,CredentialBlob=p,CredentialBlobSize=(uint)Encoding.Unicode.GetByteCount(key),Persist=2 }; if(!CredWrite(ref c,0)) throw new Exception("Credential write failed"); } finally { Marshal.ZeroFreeCoTaskMemUnicode(p); } }
public static void Delete(string target) { if(!CredDelete(target,1,0)) throw new Exception("Credential delete failed"); }
}
'@
$r = [Console]::In.ReadToEnd() | ConvertFrom-Json
$target = 'LiteraryUniverse CLI:' + $r.profile
try { if($r.action -eq 'read') { [Console]::Write([LuCredentials]::Read($target)) } elseif($r.action -eq 'store') { [LuCredentials]::Store($target,$r.key) } else { [LuCredentials]::Delete($target) } } catch { exit 1 }
`

type KeyringAction = 'read' | 'store' | 'delete'
function macKeyring(action: KeyringAction, account: string, key?: string) {
	if (action === 'store')
		return run(
			'security',
			['-i'],
			`add-generic-password -U -a ${account} -s "${service}" -w ${key}\n`,
		)
	return run('security', [
		action === 'read' ? 'find-generic-password' : 'delete-generic-password',
		'-a',
		account,
		'-s',
		service,
		...(action === 'read' ? ['-w'] : []),
	])
}

function linuxKeyring(action: KeyringAction, account: string, key?: string) {
	const args = ['service', 'literary-universe-cli', 'account', account]
	if (action === 'store')
		return run(
			'secret-tool',
			['store', '--label=Literary Universe CLI', ...args],
			`${key}\n`,
		)
	return run('secret-tool', [action === 'read' ? 'lookup' : 'clear', ...args])
}

function keyring(action: KeyringAction, baseUrl: string, key?: string) {
	const account = profile(baseUrl)
	if (process.platform === 'win32')
		return run(
			'powershell.exe',
			['-NoProfile', '-NonInteractive', '-Command', windows],
			JSON.stringify({ action, profile: account, key }),
		)
	if (process.platform === 'darwin') return macKeyring(action, account, key)
	return linuxKeyring(action, account, key)
}

export function loadKey(baseUrl: string) {
	const key = process.env.LU_TOKEN ?? keyring('read', baseUrl)
	if (!validKey(key))
		throw new LiteraryUniverseApiError(
			'INVALID_CONFIGURATION',
			'A valid LU API key is required',
		)
	return key
}

export function storeKey(baseUrl: string, key: string) {
	if (!validKey(key))
		throw new LiteraryUniverseApiError(
			'INVALID_CONFIGURATION',
			'A valid LU API key is required',
		)
	keyring('store', baseUrl, key)
	if (keyring('read', baseUrl) !== key)
		throw new LiteraryUniverseApiError(
			'KEYSTORE_UNAVAILABLE',
			'The OS credential store did not retain the key',
		)
}

export function removeKey(baseUrl: string) {
	keyring('delete', baseUrl)
}
