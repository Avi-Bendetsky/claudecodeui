import fs, { promises as fsPromises } from 'fs';
import path from 'path';
import os from 'os';

import express from 'express';
import mime from 'mime-types';

import { WORKSPACES_ROOT, validateWorkspacePath } from '@/shared/utils.js';

import { authenticateToken } from '../middleware/auth.js';
import { projectsDb } from '../modules/database/index.js';

const router = express.Router();

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

const expandWorkspacePath = (inputPath) => {
    if (!inputPath) return inputPath;
    if (inputPath === '~') {
        return WORKSPACES_ROOT;
    }
    if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
        return path.join(WORKSPACES_ROOT, inputPath.slice(2));
    }
    return inputPath;
};

function validatePathInProject(projectRoot, targetPath) {
    const resolved = path.isAbsolute(targetPath)
        ? path.resolve(targetPath)
        : path.resolve(projectRoot, targetPath);
    const normalizedRoot = path.resolve(projectRoot) + path.sep;
    if (!resolved.startsWith(normalizedRoot)) {
        return { valid: false, error: 'Path must be under project root' };
    }
    return { valid: true, resolved };
}

function validateFilename(name) {
    if (!name || !name.trim()) {
        return { valid: false, error: 'Filename cannot be empty' };
    }
    const invalidChars = /[<>:"/\\|?*\x00-\x1f]/;
    if (invalidChars.test(name)) {
        return { valid: false, error: 'Filename contains invalid characters' };
    }
    const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
    if (reserved.test(name)) {
        return { valid: false, error: 'Filename is a reserved name' };
    }
    if (/^\.+$/.test(name)) {
        return { valid: false, error: 'Filename cannot be only dots' };
    }
    return { valid: true };
}

function permToRwx(perm) {
    const r = perm & 4 ? 'r' : '-';
    const w = perm & 2 ? 'w' : '-';
    const x = perm & 1 ? 'x' : '-';
    return r + w + x;
}

async function getFileTree(dirPath, maxDepth = 3, currentDepth = 0, showHidden = true) {
    const items = [];

    try {
        const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            if (entry.name === 'node_modules' ||
                entry.name === 'dist' ||
                entry.name === 'build' ||
                entry.name === '.git' ||
                entry.name === '.svn' ||
                entry.name === '.hg') continue;

            const itemPath = path.join(dirPath, entry.name);
            const item = {
                name: entry.name,
                path: itemPath,
                type: entry.isDirectory() ? 'directory' : 'file'
            };

            try {
                const stats = await fsPromises.stat(itemPath);
                item.size = stats.size;
                item.modified = stats.mtime.toISOString();

                const mode = stats.mode;
                const ownerPerm = (mode >> 6) & 7;
                const groupPerm = (mode >> 3) & 7;
                const otherPerm = mode & 7;
                item.permissions = ((mode >> 6) & 7).toString() + ((mode >> 3) & 7).toString() + (mode & 7).toString();
                item.permissionsRwx = permToRwx(ownerPerm) + permToRwx(groupPerm) + permToRwx(otherPerm);
            } catch (statError) {
                item.size = 0;
                item.modified = null;
                item.permissions = '000';
                item.permissionsRwx = '---------';
            }

            if (entry.isDirectory() && currentDepth < maxDepth) {
                try {
                    await fsPromises.access(item.path, fs.constants.R_OK);
                    item.children = await getFileTree(item.path, maxDepth, currentDepth + 1, showHidden);
                } catch (e) {
                    item.children = [];
                }
            }

            items.push(item);
        }
    } catch (error) {
        if (error.code !== 'EACCES' && error.code !== 'EPERM') {
            console.error('Error reading directory:', error);
        }
    }

    return items.sort((a, b) => {
        if (a.type !== b.type) {
            return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
    });
}

// ---------------------------------------------------------------------------
// Browse filesystem
// ---------------------------------------------------------------------------

router.get('/api/browse-filesystem', authenticateToken, async (req, res) => {
    try {
        const { path: dirPath } = req.query;

        console.log('[API] Browse filesystem request for path:', dirPath);
        console.log('[API] WORKSPACES_ROOT is:', WORKSPACES_ROOT);
        const defaultRoot = WORKSPACES_ROOT;
        let targetPath = dirPath ? expandWorkspacePath(dirPath) : defaultRoot;

        targetPath = path.resolve(targetPath);

        const validation = await validateWorkspacePath(targetPath);
        if (!validation.valid) {
            return res.status(403).json({ error: validation.error });
        }
        const resolvedPath = validation.resolvedPath || targetPath;

        try {
            await fs.promises.access(resolvedPath);
            const stats = await fs.promises.stat(resolvedPath);

            if (!stats.isDirectory()) {
                return res.status(400).json({ error: 'Path is not a directory' });
            }
        } catch (err) {
            return res.status(404).json({ error: 'Directory not accessible' });
        }

        const fileTree = await getFileTree(resolvedPath, 1, 0, false);

        const directories = fileTree
            .filter(item => item.type === 'directory')
            .map(item => ({
                path: item.path,
                name: item.name,
                type: 'directory'
            }))
            .sort((a, b) => {
                const aHidden = a.name.startsWith('.');
                const bHidden = b.name.startsWith('.');
                if (aHidden && !bHidden) return 1;
                if (!aHidden && bHidden) return -1;
                return a.name.localeCompare(b.name);
            });

        const suggestions = [];
        let resolvedWorkspaceRoot = defaultRoot;
        try {
            resolvedWorkspaceRoot = await fsPromises.realpath(defaultRoot);
        } catch (error) {
            // Use default root as-is if realpath fails
        }
        if (resolvedPath === resolvedWorkspaceRoot) {
            const commonDirs = ['Desktop', 'Documents', 'Projects', 'Development', 'Dev', 'Code', 'workspace'];
            const existingCommon = directories.filter(dir => commonDirs.includes(dir.name));
            const otherDirs = directories.filter(dir => !commonDirs.includes(dir.name));

            suggestions.push(...existingCommon, ...otherDirs);
        } else {
            suggestions.push(...directories);
        }

        res.json({
            path: resolvedPath,
            suggestions: suggestions
        });

    } catch (error) {
        console.error('Error browsing filesystem:', error);
        res.status(500).json({ error: 'Failed to browse filesystem' });
    }
});

// ---------------------------------------------------------------------------
// Create folder
// ---------------------------------------------------------------------------

router.post('/api/create-folder', authenticateToken, async (req, res) => {
    try {
        const { path: folderPath } = req.body;
        if (!folderPath) {
            return res.status(400).json({ error: 'Path is required' });
        }
        const expandedPath = expandWorkspacePath(folderPath);
        const resolvedInput = path.resolve(expandedPath);
        const validation = await validateWorkspacePath(resolvedInput);
        if (!validation.valid) {
            return res.status(403).json({ error: validation.error });
        }
        const targetPath = validation.resolvedPath || resolvedInput;
        const parentDir = path.dirname(targetPath);
        try {
            await fs.promises.access(parentDir);
        } catch (err) {
            return res.status(404).json({ error: 'Parent directory does not exist' });
        }
        try {
            await fs.promises.access(targetPath);
            return res.status(409).json({ error: 'Folder already exists' });
        } catch (err) {
            // Folder doesn't exist, which is what we want
        }
        try {
            await fs.promises.mkdir(targetPath, { recursive: false });
            res.json({ success: true, path: targetPath });
        } catch (mkdirError) {
            if (mkdirError.code === 'EEXIST') {
                return res.status(409).json({ error: 'Folder already exists' });
            }
            throw mkdirError;
        }
    } catch (error) {
        console.error('Error creating folder:', error);
        res.status(500).json({ error: 'Failed to create folder' });
    }
});

// ---------------------------------------------------------------------------
// Read file content
// ---------------------------------------------------------------------------

router.get('/api/projects/:projectId/file', authenticateToken, async (req, res) => {
    try {
        const { projectId } = req.params;
        const { filePath } = req.query;

        if (!filePath) {
            return res.status(400).json({ error: 'Invalid file path' });
        }

        const projectRoot = await projectsDb.getProjectPathById(projectId);
        if (!projectRoot) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const resolved = path.isAbsolute(filePath)
            ? path.resolve(filePath)
            : path.resolve(projectRoot, filePath);
        const normalizedRoot = path.resolve(projectRoot) + path.sep;
        if (!resolved.startsWith(normalizedRoot)) {
            return res.status(403).json({ error: 'Path must be under project root' });
        }

        const content = await fsPromises.readFile(resolved, 'utf8');
        res.json({ content, path: resolved });
    } catch (error) {
        console.error('Error reading file:', error);
        if (error.code === 'ENOENT') {
            res.status(404).json({ error: 'File not found' });
        } else if (error.code === 'EACCES') {
            res.status(403).json({ error: 'Permission denied' });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

// ---------------------------------------------------------------------------
// Serve raw file bytes
// ---------------------------------------------------------------------------

router.get('/api/projects/:projectId/files/content', authenticateToken, async (req, res) => {
    try {
        const { projectId } = req.params;
        const { path: filePath } = req.query;

        if (!filePath) {
            return res.status(400).json({ error: 'Invalid file path' });
        }

        const projectRoot = await projectsDb.getProjectPathById(projectId);
        if (!projectRoot) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const resolved = path.isAbsolute(filePath)
            ? path.resolve(filePath)
            : path.resolve(projectRoot, filePath);
        const normalizedRoot = path.resolve(projectRoot) + path.sep;
        if (!resolved.startsWith(normalizedRoot)) {
            return res.status(403).json({ error: 'Path must be under project root' });
        }

        try {
            await fsPromises.access(resolved);
        } catch (error) {
            return res.status(404).json({ error: 'File not found' });
        }

        const mimeType = mime.lookup(resolved) || 'application/octet-stream';
        res.setHeader('Content-Type', mimeType);

        const fileStream = fs.createReadStream(resolved);
        fileStream.pipe(res);

        fileStream.on('error', (error) => {
            console.error('Error streaming file:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Error reading file' });
            }
        });

    } catch (error) {
        console.error('Error serving binary file:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

// ---------------------------------------------------------------------------
// Save file content
// ---------------------------------------------------------------------------

router.put('/api/projects/:projectId/file', authenticateToken, async (req, res) => {
    try {
        const { projectId } = req.params;
        const { filePath, content } = req.body;

        if (!filePath) {
            return res.status(400).json({ error: 'Invalid file path' });
        }

        if (content === undefined) {
            return res.status(400).json({ error: 'Content is required' });
        }

        const projectRoot = await projectsDb.getProjectPathById(projectId);
        if (!projectRoot) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const resolved = path.isAbsolute(filePath)
            ? path.resolve(filePath)
            : path.resolve(projectRoot, filePath);
        const normalizedRoot = path.resolve(projectRoot) + path.sep;
        if (!resolved.startsWith(normalizedRoot)) {
            return res.status(403).json({ error: 'Path must be under project root' });
        }

        await fsPromises.writeFile(resolved, content, 'utf8');

        res.json({
            success: true,
            path: resolved,
            message: 'File saved successfully'
        });
    } catch (error) {
        console.error('Error saving file:', error);
        if (error.code === 'ENOENT') {
            res.status(404).json({ error: 'File or directory not found' });
        } else if (error.code === 'EACCES') {
            res.status(403).json({ error: 'Permission denied' });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

// ---------------------------------------------------------------------------
// List project files
// ---------------------------------------------------------------------------

router.get('/api/projects/:projectId/files', authenticateToken, async (req, res) => {
    try {
        const actualPath = await projectsDb.getProjectPathById(req.params.projectId);
        if (!actualPath) {
            return res.status(404).json({ error: 'Project not found' });
        }

        try {
            await fsPromises.access(actualPath);
        } catch (e) {
            return res.status(404).json({ error: `Project path not found: ${actualPath}` });
        }

        const files = await getFileTree(actualPath, 10, 0, true);
        res.json(files);
    } catch (error) {
        console.error('[ERROR] File tree error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ---------------------------------------------------------------------------
// Create new file or directory
// ---------------------------------------------------------------------------

router.post('/api/projects/:projectId/files/create', authenticateToken, async (req, res) => {
    try {
        const { projectId } = req.params;
        const { path: parentPath, type, name } = req.body;

        if (!name || !type) {
            return res.status(400).json({ error: 'Name and type are required' });
        }

        if (!['file', 'directory'].includes(type)) {
            return res.status(400).json({ error: 'Type must be "file" or "directory"' });
        }

        const nameValidation = validateFilename(name);
        if (!nameValidation.valid) {
            return res.status(400).json({ error: nameValidation.error });
        }

        const projectRoot = await projectsDb.getProjectPathById(projectId);
        if (!projectRoot) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const targetDir = parentPath || '';
        const targetPath = targetDir ? path.join(targetDir, name) : name;
        const validation = validatePathInProject(projectRoot, targetPath);
        if (!validation.valid) {
            return res.status(403).json({ error: validation.error });
        }

        const resolvedPath = validation.resolved;

        try {
            await fsPromises.access(resolvedPath);
            return res.status(409).json({ error: `${type === 'file' ? 'File' : 'Directory'} already exists` });
        } catch {
            // Doesn't exist, which is what we want
        }

        if (type === 'directory') {
            await fsPromises.mkdir(resolvedPath, { recursive: false });
        } else {
            const parentDir = path.dirname(resolvedPath);
            try {
                await fsPromises.access(parentDir);
            } catch {
                await fsPromises.mkdir(parentDir, { recursive: true });
            }
            await fsPromises.writeFile(resolvedPath, '', 'utf8');
        }

        res.json({
            success: true,
            path: resolvedPath,
            name,
            type,
            message: `${type === 'file' ? 'File' : 'Directory'} created successfully`
        });
    } catch (error) {
        console.error('Error creating file/directory:', error);
        if (error.code === 'EACCES') {
            res.status(403).json({ error: 'Permission denied' });
        } else if (error.code === 'ENOENT') {
            res.status(404).json({ error: 'Parent directory not found' });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

// ---------------------------------------------------------------------------
// Rename file or directory
// ---------------------------------------------------------------------------

router.put('/api/projects/:projectId/files/rename', authenticateToken, async (req, res) => {
    try {
        const { projectId } = req.params;
        const { oldPath, newName } = req.body;

        if (!oldPath || !newName) {
            return res.status(400).json({ error: 'oldPath and newName are required' });
        }

        const nameValidation = validateFilename(newName);
        if (!nameValidation.valid) {
            return res.status(400).json({ error: nameValidation.error });
        }

        const projectRoot = await projectsDb.getProjectPathById(projectId);
        if (!projectRoot) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const oldValidation = validatePathInProject(projectRoot, oldPath);
        if (!oldValidation.valid) {
            return res.status(403).json({ error: oldValidation.error });
        }

        const resolvedOldPath = oldValidation.resolved;

        try {
            await fsPromises.access(resolvedOldPath);
        } catch {
            return res.status(404).json({ error: 'File or directory not found' });
        }

        const parentDir = path.dirname(resolvedOldPath);
        const resolvedNewPath = path.join(parentDir, newName);
        const newValidation = validatePathInProject(projectRoot, resolvedNewPath);
        if (!newValidation.valid) {
            return res.status(403).json({ error: newValidation.error });
        }

        try {
            await fsPromises.access(resolvedNewPath);
            return res.status(409).json({ error: 'A file or directory with this name already exists' });
        } catch {
            // Doesn't exist, which is what we want
        }

        await fsPromises.rename(resolvedOldPath, resolvedNewPath);

        res.json({
            success: true,
            oldPath: resolvedOldPath,
            newPath: resolvedNewPath,
            newName,
            message: 'Renamed successfully'
        });
    } catch (error) {
        console.error('Error renaming file/directory:', error);
        if (error.code === 'EACCES') {
            res.status(403).json({ error: 'Permission denied' });
        } else if (error.code === 'ENOENT') {
            res.status(404).json({ error: 'File or directory not found' });
        } else if (error.code === 'EXDEV') {
            res.status(400).json({ error: 'Cannot move across different filesystems' });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

// ---------------------------------------------------------------------------
// Delete file or directory
// ---------------------------------------------------------------------------

router.delete('/api/projects/:projectId/files', authenticateToken, async (req, res) => {
    try {
        const { projectId } = req.params;
        const { path: targetPath, type } = req.body;

        if (!targetPath) {
            return res.status(400).json({ error: 'Path is required' });
        }

        const projectRoot = await projectsDb.getProjectPathById(projectId);
        if (!projectRoot) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const validation = validatePathInProject(projectRoot, targetPath);
        if (!validation.valid) {
            return res.status(403).json({ error: validation.error });
        }

        const resolvedPath = validation.resolved;

        let stats;
        try {
            stats = await fsPromises.stat(resolvedPath);
        } catch {
            return res.status(404).json({ error: 'File or directory not found' });
        }

        if (resolvedPath === path.resolve(projectRoot)) {
            return res.status(403).json({ error: 'Cannot delete project root directory' });
        }

        if (stats.isDirectory()) {
            await fsPromises.rm(resolvedPath, { recursive: true, force: true });
        } else {
            await fsPromises.unlink(resolvedPath);
        }

        res.json({
            success: true,
            path: resolvedPath,
            type: stats.isDirectory() ? 'directory' : 'file',
            message: 'Deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting file/directory:', error);
        if (error.code === 'EACCES') {
            res.status(403).json({ error: 'Permission denied' });
        } else if (error.code === 'ENOENT') {
            res.status(404).json({ error: 'File or directory not found' });
        } else if (error.code === 'ENOTEMPTY') {
            res.status(400).json({ error: 'Directory is not empty' });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

// ---------------------------------------------------------------------------
// Upload files
// ---------------------------------------------------------------------------

const uploadFilesHandler = async (req, res) => {
    const multer = (await import('multer')).default;

    const uploadMiddleware = multer({
        storage: multer.diskStorage({
            destination: (req, file, cb) => {
                cb(null, os.tmpdir());
            },
            filename: (req, file, cb) => {
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                cb(null, `upload-${uniqueSuffix}`);
            }
        }),
        limits: {
            fileSize: 50 * 1024 * 1024,
            files: 20
        }
    });

    uploadMiddleware.array('files', 20)(req, res, async (err) => {
        if (err) {
            console.error('Multer error:', err);
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ error: 'File too large. Maximum size is 50MB.' });
            }
            if (err.code === 'LIMIT_FILE_COUNT') {
                return res.status(400).json({ error: 'Too many files. Maximum is 20 files.' });
            }
            return res.status(500).json({ error: err.message });
        }

        try {
            const { projectId } = req.params;
            const { targetPath, relativePaths } = req.body;

            let filePaths = [];
            if (relativePaths) {
                try {
                    filePaths = JSON.parse(relativePaths);
                } catch (e) {
                    console.log('[DEBUG] Failed to parse relativePaths:', relativePaths);
                }
            }

            console.log('[DEBUG] File upload request:', {
                projectId,
                targetPath: JSON.stringify(targetPath),
                targetPathType: typeof targetPath,
                filesCount: req.files?.length,
                relativePaths: filePaths
            });

            if (!req.files || req.files.length === 0) {
                return res.status(400).json({ error: 'No files provided' });
            }

            const projectRoot = await projectsDb.getProjectPathById(projectId);
            if (!projectRoot) {
                return res.status(404).json({ error: 'Project not found' });
            }

            console.log('[DEBUG] Project root:', projectRoot);

            const targetDir = targetPath || '';
            let resolvedTargetDir;

            console.log('[DEBUG] Target dir:', JSON.stringify(targetDir));

            if (!targetDir || targetDir === '.' || targetDir === './') {
                resolvedTargetDir = path.resolve(projectRoot);
                console.log('[DEBUG] Using project root as target:', resolvedTargetDir);
            } else {
                const validation = validatePathInProject(projectRoot, targetDir);
                if (!validation.valid) {
                    console.log('[DEBUG] Path validation failed:', validation.error);
                    return res.status(403).json({ error: validation.error });
                }
                resolvedTargetDir = validation.resolved;
                console.log('[DEBUG] Resolved target dir:', resolvedTargetDir);
            }

            try {
                await fsPromises.access(resolvedTargetDir);
            } catch {
                await fsPromises.mkdir(resolvedTargetDir, { recursive: true });
            }

            const uploadedFiles = [];
            console.log('[DEBUG] Processing files:', req.files.map(f => ({ originalname: f.originalname, path: f.path })));
            for (let i = 0; i < req.files.length; i++) {
                const file = req.files[i];
                const fileName = (filePaths && filePaths[i]) ? filePaths[i] : file.originalname;
                console.log('[DEBUG] Processing file:', fileName, '(originalname:', file.originalname + ')');
                const destPath = path.join(resolvedTargetDir, fileName);

                const destValidation = validatePathInProject(projectRoot, destPath);
                if (!destValidation.valid) {
                    console.log('[DEBUG] Destination validation failed for:', destPath);
                    await fsPromises.unlink(file.path).catch(() => {});
                    continue;
                }

                const parentDir = path.dirname(destPath);
                try {
                    await fsPromises.access(parentDir);
                } catch {
                    await fsPromises.mkdir(parentDir, { recursive: true });
                }

                await fsPromises.copyFile(file.path, destPath);
                await fsPromises.unlink(file.path);

                uploadedFiles.push({
                    name: fileName,
                    path: destPath,
                    size: file.size,
                    mimeType: file.mimetype
                });
            }

            res.json({
                success: true,
                files: uploadedFiles,
                targetPath: resolvedTargetDir,
                message: `Uploaded ${uploadedFiles.length} file(s) successfully`
            });
        } catch (error) {
            console.error('Error uploading files:', error);
            if (req.files) {
                for (const file of req.files) {
                    await fsPromises.unlink(file.path).catch(() => {});
                }
            }
            if (error.code === 'EACCES') {
                res.status(403).json({ error: 'Permission denied' });
            } else {
                res.status(500).json({ error: error.message });
            }
        }
    });
};

router.post('/api/projects/:projectId/files/upload', authenticateToken, uploadFilesHandler);

// ---------------------------------------------------------------------------
// Image upload
// ---------------------------------------------------------------------------

router.post('/api/projects/:projectId/upload-images', authenticateToken, async (req, res) => {
    try {
        const multer = (await import('multer')).default;
        const path = (await import('path')).default;
        const fs = (await import('fs')).promises;
        const os = (await import('os')).default;

        const storage = multer.diskStorage({
            destination: async (req, file, cb) => {
                const uploadDir = path.join(os.tmpdir(), 'claude-ui-uploads', String(req.user.id));
                await fs.mkdir(uploadDir, { recursive: true });
                cb(null, uploadDir);
            },
            filename: (req, file, cb) => {
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
                cb(null, uniqueSuffix + '-' + sanitizedName);
            }
        });

        const fileFilter = (req, file, cb) => {
            const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
            if (allowedMimes.includes(file.mimetype)) {
                cb(null, true);
            } else {
                cb(new Error('Invalid file type. Only JPEG, PNG, GIF, WebP, and SVG are allowed.'));
            }
        };

        const upload = multer({
            storage,
            fileFilter,
            limits: {
                fileSize: 5 * 1024 * 1024,
                files: 5
            }
        });

        upload.array('images', 5)(req, res, async (err) => {
            if (err) {
                return res.status(400).json({ error: err.message });
            }

            if (!req.files || req.files.length === 0) {
                return res.status(400).json({ error: 'No image files provided' });
            }

            try {
                const processedImages = await Promise.all(
                    req.files.map(async (file) => {
                        const buffer = await fs.readFile(file.path);
                        const base64 = buffer.toString('base64');
                        const mimeType = file.mimetype;

                        await fs.unlink(file.path);

                        return {
                            name: file.originalname,
                            data: `data:${mimeType};base64,${base64}`,
                            size: file.size,
                            mimeType: mimeType
                        };
                    })
                );

                res.json({ images: processedImages });
            } catch (error) {
                console.error('Error processing images:', error);
                await Promise.all(req.files.map(f => fs.unlink(f.path).catch(() => { })));
                res.status(500).json({ error: 'Failed to process images' });
            }
        });
    } catch (error) {
        console.error('Error in image upload endpoint:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ---------------------------------------------------------------------------
// Token usage
// ---------------------------------------------------------------------------

router.get('/api/projects/:projectId/sessions/:sessionId/token-usage', authenticateToken, async (req, res) => {
    try {
        const { projectId, sessionId } = req.params;
        const { provider = 'claude' } = req.query;
        const homeDir = os.homedir();

        const safeSessionId = String(sessionId).replace(/[^a-zA-Z0-9._-]/g, '');
        if (!safeSessionId || safeSessionId !== String(sessionId)) {
            return res.status(400).json({ error: 'Invalid sessionId' });
        }

        if (provider === 'cursor') {
            return res.json({
                used: 0,
                total: 0,
                breakdown: { input: 0, cacheCreation: 0, cacheRead: 0 },
                unsupported: true,
                message: 'Token usage tracking not available for Cursor sessions'
            });
        }

        if (provider === 'gemini') {
            return res.json({
                used: 0,
                total: 0,
                breakdown: { input: 0, cacheCreation: 0, cacheRead: 0 },
                unsupported: true,
                message: 'Token usage tracking not available for Gemini sessions'
            });
        }

        if (provider === 'codex') {
            const codexSessionsDir = path.join(homeDir, '.codex', 'sessions');

            const findSessionFile = async (dir) => {
                try {
                    const entries = await fsPromises.readdir(dir, { withFileTypes: true });
                    for (const entry of entries) {
                        const fullPath = path.join(dir, entry.name);
                        if (entry.isDirectory()) {
                            const found = await findSessionFile(fullPath);
                            if (found) return found;
                        } else if (entry.name.includes(safeSessionId) && entry.name.endsWith('.jsonl')) {
                            return fullPath;
                        }
                    }
                } catch (error) {
                    // Skip directories we can't read
                }
                return null;
            };

            const sessionFilePath = await findSessionFile(codexSessionsDir);

            if (!sessionFilePath) {
                return res.status(404).json({ error: 'Codex session file not found', sessionId: safeSessionId });
            }

            let fileContent;
            try {
                fileContent = await fsPromises.readFile(sessionFilePath, 'utf8');
            } catch (error) {
                if (error.code === 'ENOENT') {
                    return res.status(404).json({ error: 'Session file not found', path: sessionFilePath });
                }
                throw error;
            }
            const lines = fileContent.trim().split('\n');
            let totalTokens = 0;
            let contextWindow = 200000;

            for (let i = lines.length - 1; i >= 0; i--) {
                try {
                    const entry = JSON.parse(lines[i]);

                    if (entry.type === 'event_msg' && entry.payload?.type === 'token_count' && entry.payload?.info) {
                        const tokenInfo = entry.payload.info;
                        if (tokenInfo.total_token_usage) {
                            totalTokens = tokenInfo.total_token_usage.total_tokens || 0;
                        }
                        if (tokenInfo.model_context_window) {
                            contextWindow = tokenInfo.model_context_window;
                        }
                        break;
                    }
                } catch (parseError) {
                    continue;
                }
            }

            return res.json({
                used: totalTokens,
                total: contextWindow
            });
        }

        // Handle Claude sessions (default)
        const projectPath = await projectsDb.getProjectPathById(projectId);
        if (!projectPath) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const encodedPath = projectPath.replace(/[^a-zA-Z0-9-]/g, '-');
        const projectDir = path.join(homeDir, '.claude', 'projects', encodedPath);

        const jsonlPath = path.join(projectDir, `${safeSessionId}.jsonl`);

        const rel = path.relative(path.resolve(projectDir), path.resolve(jsonlPath));
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
            return res.status(400).json({ error: 'Invalid path' });
        }

        let fileContent;
        try {
            fileContent = await fsPromises.readFile(jsonlPath, 'utf8');
        } catch (error) {
            if (error.code === 'ENOENT') {
                return res.status(404).json({ error: 'Session file not found', path: jsonlPath });
            }
            throw error;
        }
        const lines = fileContent.trim().split('\n');

        const parsedContextWindow = parseInt(process.env.CONTEXT_WINDOW, 10);
        const contextWindow = Number.isFinite(parsedContextWindow) ? parsedContextWindow : 160000;
        let inputTokens = 0;
        let cacheCreationTokens = 0;
        let cacheReadTokens = 0;

        for (let i = lines.length - 1; i >= 0; i--) {
            try {
                const entry = JSON.parse(lines[i]);

                if (entry.type === 'assistant' && entry.message?.usage) {
                    const usage = entry.message.usage;

                    inputTokens = usage.input_tokens || 0;
                    cacheCreationTokens = usage.cache_creation_input_tokens || 0;
                    cacheReadTokens = usage.cache_read_input_tokens || 0;

                    break;
                }
            } catch (parseError) {
                continue;
            }
        }

        const totalUsed = inputTokens + cacheCreationTokens + cacheReadTokens;

        res.json({
            used: totalUsed,
            total: contextWindow,
            breakdown: {
                input: inputTokens,
                cacheCreation: cacheCreationTokens,
                cacheRead: cacheReadTokens
            }
        });
    } catch (error) {
        console.error('Error reading session token usage:', error);
        res.status(500).json({ error: 'Failed to read session token usage' });
    }
});

export default router;
