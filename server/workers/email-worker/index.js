// Cloudflare Worker for handling temporary email service

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// 简化日志
function logInfo(message, data = {}) {
    console.log(`[INFO] ${message}`, data);
}

function logError(message, error) {
    console.error(`[ERROR] ${message}`, error);
}

// KV namespace binding name: tempEmail

async function handleOptions(request) {
    return new Response(null, {
        headers: corsHeaders
    });
}

async function generateEmailAddress(env) {
    try {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let username = '';
        for (let i = 0; i < 8; i++) {
            username += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        // 使用环境变量中的域名
        const domain = env.EMAIL_DOMAIN || "777.xyz";
        const emailAddress = `${username}@${domain}`;

        return emailAddress;
    } catch (error) {
        logError("生成邮箱地址失败");
        throw error;
    }
}

async function handleNewEmail(request, env) {
    try {
        const email = await request.json();
        const timestamp = new Date().getTime();

        // 验证必要的邮件字段
        if (!email.from || !email.to || !email.subject) {
            return new Response(JSON.stringify({error: "缺少必要的邮件字段"}), {
                status: 400,
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders
                }
            });
        }

        // 确保 text 字段存在 - 如果没有，使用 content 或空字符串
        if (!email.text) {
            email.text = email.content || '';
        }

        // 使用邮箱地址作为键的一部分，确保唯一性
        const emailAddress = email.to.toLowerCase().trim();

        // 检查 D1 绑定是否存在
        if (!env.DB) {
            logError('D1 绑定不存在');
            return new Response(JSON.stringify({error: 'D1数据库未配置'}), {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders
                }
            });
        }

        // 调用saveEmail函数保存邮件到D1
        try {
            await saveEmail(env, email);
            return new Response(JSON.stringify({success: true}), {
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders
                }
            });
        } catch (error) {
            logError(`保存邮件到D1失败: ${error.message}`);
            return new Response(JSON.stringify({error: `保存邮件失败: ${error.message}`}), {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders
                }
            });
        }
    } catch (error) {
        logError('处理新邮件失败');
        return new Response(JSON.stringify({error: error.message}), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
            }
        });
    }
}

/**
 * 从D1数据库获取邮件列表
 * 只使用D1，不再回退到KV
 */
async function getEmails(request, env) {
    try {
        logInfo(env);
        const {searchParams} = new URL(request.url);
        const address = searchParams.get('address');

        if (!address) {
            logError('获取邮件时缺少地址参数');
            return new Response(JSON.stringify({error: "需要提供邮箱地址"}), {
                status: 400,
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders
                }
            });
        }

        const normalizedAddress = address.toLowerCase().trim();
        const noCache = searchParams.get('no_cache') === 'true';

        // 设置缓存控制标头
        const cacheHeaders = {
            'Content-Type': 'application/json',
            ...corsHeaders,
            ...(noCache ? {
                'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            } : {
                'Cache-Control': 'public, max-age=5'
            })
        };

        // 只从D1获取数据，不再回退到KV
        if (!env.DB) {
            logError('D1绑定不存在');
            return new Response(JSON.stringify({error: 'D1数据库未配置'}), {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders
                }
            });
        }

        logInfo(`从D1查询邮件，地址: ${normalizedAddress}`);

        // 查询D1数据库
        const stmt = env.DB.prepare(`
            SELECT id,
                   email_address,
                   sender       as "from",
                   subject,
                   content,
                   text_content as text,
                   html_content as html,
                   received_at  as receivedAt
            FROM emails
            WHERE email_address = ?
            ORDER BY received_at DESC LIMIT 100
        `).bind(normalizedAddress);

        const result = await stmt.all();

        if (!result.success) {
            throw new Error('数据库查询失败');
        }

        // 格式化结果
        const emails = result.results.map(email => {
            return {
                id: email.id.toString(),
                receivedAt: email.receivedAt,
                from: email.from,
                to: normalizedAddress,
                subject: email.subject,
                text: email.text || '',
                html: email.html || '',
                content: email.content,
                // 简化预览
                preview: email.text ? email.text.slice(0, 100) : (email.subject || '无内容')
            };
        });

        logInfo(`从D1返回 ${emails.length} 封邮件`);

        return new Response(JSON.stringify(emails), {
            headers: cacheHeaders
        });
    } catch (error) {
        logError(`获取邮件列表失败: ${error.message}`);
        return new Response(JSON.stringify({
            error: '无法获取邮件',
            details: error.message
        }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
            }
        });
    }
}

/**
 * 清空指定邮箱的所有邮件
 * 只使用D1，不再操作KV
 */
async function clearEmails(request, env) {
    try {
        const {searchParams} = new URL(request.url);
        const address = searchParams.get('address');

        if (!address) {
            logError('清空邮件时缺少地址参数');
            return new Response(JSON.stringify({error: "需要提供邮箱地址"}), {
                status: 400,
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders
                }
            });
        }

        const normalizedAddress = address.toLowerCase().trim();
        logInfo(`准备清空邮件，地址: ${normalizedAddress}`);

        // 检查D1绑定
        if (!env.DB) {
            logError('D1绑定不存在');
            return new Response(JSON.stringify({
                success: false,
                error: 'D1数据库未配置'
            }), {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders
                }
            });
        }

        // 从D1删除邮件
        try {
            // 删除指定邮箱地址的所有邮件
            const stmt = env.DB.prepare(`
                DELETE
                FROM emails
                WHERE email_address = ?
            `).bind(normalizedAddress);

            const result = await stmt.run();

            if (!result.success) {
                throw new Error('数据库删除操作失败');
            }

            const deletedCount = result.meta?.changes || 0;
            logInfo(`成功从D1删除 ${deletedCount} 封邮件`);

            return new Response(JSON.stringify({
                success: true,
                message: `成功删除 ${deletedCount} 封邮件`
            }), {
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders
                }
            });
        } catch (error) {
            logError(`从D1删除邮件失败: ${error.message}`);
            return new Response(JSON.stringify({
                success: false,
                error: '清空邮件失败',
                details: error.message
            }), {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders
                }
            });
        }
    } catch (error) {
        logError(`清空邮件失败: ${error.message}`);
        return new Response(JSON.stringify({error: error.message}), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
            }
        });
    }
}

/**
 * 清空所有过期邮件
 * 只使用D1，不再操作KV
 */
async function clearAllEmails(request, env) {
    try {
        logInfo(`准备清空所有过期邮件`);

        // 检查D1绑定
        if (!env.DB) {
            logError('D1绑定不存在');
            return new Response(JSON.stringify({
                success: false,
                error: 'D1数据库未配置'
            }), {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders
                }
            });
        }

        // 从D1清除过期邮件
        try {
            const now = Date.now();
            const cutoffTime = now - (24 * 60 * 60 * 1000); // 1天前的时间戳

            // 删除过期邮件
            const stmt = env.DB.prepare(`
                DELETE
                FROM emails
                WHERE received_at < ?
            `).bind(cutoffTime);

            const result = await stmt.run();

            if (!result.success) {
                throw new Error('数据库删除操作失败');
            }

            const deletedCount = result.meta?.changes || 0;
            logInfo(`成功从D1删除 ${deletedCount} 封过期邮件`);

            return new Response(JSON.stringify({
                success: true,
                message: `成功删除 ${deletedCount} 封过期邮件`
            }), {
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders
                }
            });
        } catch (error) {
            logError(`从D1删除过期邮件失败: ${error.message}`);
            return new Response(JSON.stringify({
                success: false,
                error: '清空过期邮件失败',
                details: error.message
            }), {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders
                }
            });
        }
    } catch (error) {
        logError(`清空过期邮件失败: ${error.message}`);
        return new Response(JSON.stringify({error: error.message}), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
            }
        });
    }
}

/**
 * 保存邮件到数据库
 * 只保存到D1数据库，不使用KV
 */
async function saveEmail(env, email) {
    logInfo('准备保存邮件');
    const emailData = extractEmailData(email);

    // 检查D1绑定
    if (!env.DB) {
        logError('D1绑定不存在，无法保存邮件');
        throw new Error('D1数据库未配置');
    }

    try {
        // 插入邮件到D1
        const stmt = env.DB.prepare(`
            INSERT INTO emails (email_address,
                                from_address,
                                subject,
                                text_content,
                                html_content,
                                received_at,
                                raw_email)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
            emailData.to,
            emailData.from,
            emailData.subject,
            emailData.text,
            emailData.html,
            Date.now(),
            emailData.raw
        );

        const result = await stmt.run();

        if (!result.success) {
            throw new Error('数据库插入操作失败');
        }

        logInfo(`成功将邮件保存到D1，收件人: ${emailData.to}`);
        return true;
    } catch (error) {
        logError(`保存邮件到D1失败: ${error.message}`);
        throw error; // 重新抛出以便调用者处理
    }
}

async function handleRequest(request, env) {
    // 检查 env 对象是否存在
    if (!env) {
        logError('环境变量对象不存在');
        return new Response(JSON.stringify({error: '服务器配置错误'}), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
            }
        });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
        return handleOptions(request);
    }

    try {
        // 处理 DELETE 请求清空邮件
        if (request.method === 'DELETE') {
            if (path === '/emails/clear') {
                return clearEmails(request, env);
            } else if (path === '/emails/clear-all') { // 新增清空所有邮件的路由
                return clearAllEmails(request, env);
            }
        }

        // 其他请求方法
        switch (path) {
            case '/generate':
                const address = await generateEmailAddress(env);
                return new Response(JSON.stringify({address}), {
                    headers: {
                        'Content-Type': 'application/json',
                        ...corsHeaders
                    }
                });
            case '/emails':
                return getEmails(request, env);
            case '/email':
                return handleNewEmail(request, env);
            default:
                return new Response('Not found', {status: 404});
        }
    } catch (err) {
        logError(`请求处理错误: ${err.message}`);
        return new Response(JSON.stringify({error: err.message}), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
            }
        });
    }
}

// 使用新的模块格式导出处理函数
export default {
    async fetch(request, env, ctx) {
        return handleRequest(request, env);
    },

    // 添加 scheduled 事件处理程序以响应 Cron Triggers
    async scheduled(event, env, ctx) {
        logInfo(`Cron Trigger 启动: ${event.cron}`);
        try {
            // 调用 clearAllEmails 函数清理过期邮件
            // 注意：scheduled 事件没有 request 对象，所以第一个参数传 null
            const result = await clearAllEmails(null, env);
            // 可以选择性地记录清理结果
            const resultBody = await result.json();
            logInfo('定时清理任务完成', resultBody);
        } catch (error) {
            logError('定时清理任务失败', error);
        }
    }
};

// 保留原有的事件监听器，以兼容旧版本
addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request, event.env));
});