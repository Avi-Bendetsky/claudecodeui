import os from 'os';
import { spawn } from 'child_process';

import express from 'express';

import { authenticateToken } from '../middleware/auth.js';
import { IS_PLATFORM } from '../constants/config.js';

export function createSystemRoutes({ appRoot, installMode }) {
    const router = express.Router();
    router.post('/api/system/update', authenticateToken, async (req, res) => {
        try {
            const projectRoot = appRoot;

            console.log('Starting system update from directory:', projectRoot);

            const updateCommand = IS_PLATFORM
                ? 'npm run update:platform'
                : installMode === 'git'
                    ? 'git checkout main && git pull && npm install'
                    : 'npm install -g @cloudcli-ai/cloudcli@latest';

            const updateCwd = IS_PLATFORM || installMode === 'git'
                ? projectRoot
                : os.homedir();

            const child = spawn('sh', ['-c', updateCommand], {
                cwd: updateCwd,
                env: process.env
            });

            let output = '';
            let errorOutput = '';

            child.stdout.on('data', (data) => {
                const text = data.toString();
                output += text;
                console.log('Update output:', text);
            });

            child.stderr.on('data', (data) => {
                const text = data.toString();
                errorOutput += text;
                console.error('Update error:', text);
            });

            child.on('close', (code) => {
                if (code === 0) {
                    res.json({
                        success: true,
                        output: output || 'Update completed successfully',
                        message: 'Update completed. Please restart the server to apply changes.'
                    });
                } else {
                    res.status(500).json({
                        success: false,
                        error: 'Update command failed',
                        output: output,
                        errorOutput: errorOutput
                    });
                }
            });

            child.on('error', (error) => {
                console.error('Update process error:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            });

        } catch (error) {
            console.error('System update error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    return router;
}
