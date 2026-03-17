use std::collections::HashSet;

use chrono::{Duration, Local};
use rusqlite::OptionalExtension;

use crate::db::open_db;
use crate::models::IndustryNode;

// ============================================================
// 1. Career Templates — 预置职业技能树模板
// ============================================================

#[derive(serde::Serialize, Clone)]
pub struct CareerTemplate {
    pub id: String,
    pub name: String,
    pub description: String,
    pub skills: Vec<TemplateSkill>,
}

#[derive(serde::Serialize, Clone)]
pub struct TemplateSkill {
    pub name: String,
    pub importance: i64,
    pub children: Vec<String>,
}

fn build_templates() -> Vec<CareerTemplate> {
    vec![
        CareerTemplate {
            id: "frontend".into(),
            name: "前端工程师".into(),
            description: "Web 前端开发，涵盖框架、性能、工程化".into(),
            skills: vec![
                TemplateSkill { name: "HTML/CSS".into(), importance: 5, children: vec!["语义化 HTML".into(), "CSS Grid/Flexbox".into(), "响应式设计".into(), "CSS 动画".into()] },
                TemplateSkill { name: "JavaScript/TypeScript".into(), importance: 5, children: vec!["ES6+ 语法".into(), "TypeScript 类型系统".into(), "异步编程".into(), "模块化".into()] },
                TemplateSkill { name: "React/Vue 框架".into(), importance: 5, children: vec!["组件设计".into(), "状态管理".into(), "路由".into(), "Hooks".into()] },
                TemplateSkill { name: "前端工程化".into(), importance: 4, children: vec!["Webpack/Vite".into(), "CI/CD".into(), "代码规范".into(), "单元测试".into()] },
                TemplateSkill { name: "性能优化".into(), importance: 4, children: vec!["懒加载".into(), "缓存策略".into(), "Core Web Vitals".into()] },
                TemplateSkill { name: "Node.js".into(), importance: 3, children: vec!["Express/Koa".into(), "SSR".into(), "BFF 层".into()] },
            ],
        },
        CareerTemplate {
            id: "backend".into(),
            name: "后端工程师".into(),
            description: "服务端开发，涵盖架构、数据库、微服务".into(),
            skills: vec![
                TemplateSkill { name: "编程语言".into(), importance: 5, children: vec!["Java/Go/Python".into(), "并发编程".into(), "设计模式".into()] },
                TemplateSkill { name: "数据库".into(), importance: 5, children: vec!["SQL 优化".into(), "索引设计".into(), "Redis".into(), "分库分表".into()] },
                TemplateSkill { name: "系统设计".into(), importance: 5, children: vec!["高可用架构".into(), "分布式系统".into(), "消息队列".into(), "负载均衡".into()] },
                TemplateSkill { name: "微服务".into(), importance: 4, children: vec!["服务拆分".into(), "gRPC".into(), "服务治理".into(), "容器化".into()] },
                TemplateSkill { name: "DevOps".into(), importance: 4, children: vec!["Docker".into(), "Kubernetes".into(), "CI/CD 流水线".into(), "监控告警".into()] },
                TemplateSkill { name: "安全".into(), importance: 3, children: vec!["认证授权".into(), "数据加密".into(), "OWASP".into()] },
            ],
        },
        CareerTemplate {
            id: "fullstack".into(),
            name: "全栈工程师".into(),
            description: "前后端通吃，产品到部署全链路".into(),
            skills: vec![
                TemplateSkill { name: "前端开发".into(), importance: 5, children: vec!["React/Vue".into(), "HTML/CSS".into(), "TypeScript".into()] },
                TemplateSkill { name: "后端开发".into(), importance: 5, children: vec!["Node.js/Python".into(), "REST API".into(), "GraphQL".into()] },
                TemplateSkill { name: "数据库".into(), importance: 4, children: vec!["PostgreSQL/MySQL".into(), "MongoDB".into(), "ORM".into()] },
                TemplateSkill { name: "部署运维".into(), importance: 4, children: vec!["Docker".into(), "云服务".into(), "Nginx".into()] },
                TemplateSkill { name: "产品思维".into(), importance: 3, children: vec!["需求分析".into(), "用户体验".into(), "数据驱动".into()] },
            ],
        },
        CareerTemplate {
            id: "data_analyst".into(),
            name: "数据分析师".into(),
            description: "数据驱动决策，SQL、可视化、统计分析".into(),
            skills: vec![
                TemplateSkill { name: "SQL".into(), importance: 5, children: vec!["复杂查询".into(), "窗口函数".into(), "数据建模".into()] },
                TemplateSkill { name: "Python 数据分析".into(), importance: 5, children: vec!["Pandas".into(), "NumPy".into(), "数据清洗".into()] },
                TemplateSkill { name: "统计学".into(), importance: 4, children: vec!["假设检验".into(), "回归分析".into(), "A/B 测试".into()] },
                TemplateSkill { name: "数据可视化".into(), importance: 4, children: vec!["Tableau/PowerBI".into(), "ECharts".into(), "数据叙事".into()] },
                TemplateSkill { name: "业务分析".into(), importance: 4, children: vec!["指标体系".into(), "归因分析".into(), "漏斗分析".into()] },
                TemplateSkill { name: "机器学习基础".into(), importance: 3, children: vec!["分类/回归".into(), "聚类".into(), "特征工程".into()] },
            ],
        },
        CareerTemplate {
            id: "ai_engineer".into(),
            name: "AI 工程师".into(),
            description: "人工智能与机器学习工程化落地".into(),
            skills: vec![
                TemplateSkill { name: "机器学习".into(), importance: 5, children: vec!["监督学习".into(), "无监督学习".into(), "模型评估".into(), "特征工程".into()] },
                TemplateSkill { name: "深度学习".into(), importance: 5, children: vec!["CNN".into(), "RNN/Transformer".into(), "PyTorch/TensorFlow".into()] },
                TemplateSkill { name: "NLP".into(), importance: 4, children: vec!["文本分类".into(), "NER".into(), "大语言模型".into(), "RAG".into()] },
                TemplateSkill { name: "MLOps".into(), importance: 4, children: vec!["模型部署".into(), "模型监控".into(), "实验管理".into()] },
                TemplateSkill { name: "数据工程".into(), importance: 4, children: vec!["ETL 管道".into(), "特征存储".into(), "数据质量".into()] },
                TemplateSkill { name: "Prompt 工程".into(), importance: 3, children: vec!["提示词设计".into(), "Chain of Thought".into(), "Agent 设计".into()] },
            ],
        },
        CareerTemplate {
            id: "product_manager".into(),
            name: "产品经理".into(),
            description: "从需求到上线的全流程产品管理".into(),
            skills: vec![
                TemplateSkill { name: "需求分析".into(), importance: 5, children: vec!["用户调研".into(), "竞品分析".into(), "需求优先级".into(), "PRD 撰写".into()] },
                TemplateSkill { name: "用户体验".into(), importance: 5, children: vec!["交互设计".into(), "信息架构".into(), "用户旅程".into(), "可用性测试".into()] },
                TemplateSkill { name: "数据驱动".into(), importance: 4, children: vec!["指标体系".into(), "A/B 测试".into(), "漏斗分析".into(), "数据看板".into()] },
                TemplateSkill { name: "项目管理".into(), importance: 4, children: vec!["敏捷开发".into(), "路线图".into(), "跨团队协作".into()] },
                TemplateSkill { name: "商业思维".into(), importance: 4, children: vec!["商业模式".into(), "增长策略".into(), "竞争分析".into()] },
                TemplateSkill { name: "技术理解".into(), importance: 3, children: vec!["API 基础".into(), "数据库概念".into(), "前后端架构".into()] },
            ],
        },
        CareerTemplate {
            id: "devops".into(),
            name: "DevOps 工程师".into(),
            description: "自动化、容器化、持续交付".into(),
            skills: vec![
                TemplateSkill { name: "Linux 系统管理".into(), importance: 5, children: vec!["Shell 脚本".into(), "系统调优".into(), "网络配置".into()] },
                TemplateSkill { name: "容器技术".into(), importance: 5, children: vec!["Docker".into(), "Kubernetes".into(), "Helm".into()] },
                TemplateSkill { name: "CI/CD".into(), importance: 5, children: vec!["Jenkins/GitLab CI".into(), "自动化测试".into(), "制品管理".into()] },
                TemplateSkill { name: "云平台".into(), importance: 4, children: vec!["AWS/阿里云".into(), "Terraform".into(), "Serverless".into()] },
                TemplateSkill { name: "监控告警".into(), importance: 4, children: vec!["Prometheus".into(), "Grafana".into(), "日志管理".into()] },
            ],
        },
        CareerTemplate {
            id: "ui_designer".into(),
            name: "UI/UX 设计师".into(),
            description: "用户界面与体验设计".into(),
            skills: vec![
                TemplateSkill { name: "视觉设计".into(), importance: 5, children: vec!["色彩理论".into(), "排版".into(), "图标设计".into(), "品牌规范".into()] },
                TemplateSkill { name: "交互设计".into(), importance: 5, children: vec!["原型设计".into(), "信息架构".into(), "动效设计".into()] },
                TemplateSkill { name: "用户研究".into(), importance: 4, children: vec!["用户访谈".into(), "可用性测试".into(), "用户画像".into()] },
                TemplateSkill { name: "设计工具".into(), importance: 4, children: vec!["Figma".into(), "Sketch".into(), "Adobe 套件".into()] },
                TemplateSkill { name: "设计系统".into(), importance: 3, children: vec!["组件库".into(), "设计规范".into(), "Design Token".into()] },
            ],
        },
        CareerTemplate {
            id: "mobile".into(),
            name: "移动端开发工程师".into(),
            description: "iOS/Android/跨平台移动开发".into(),
            skills: vec![
                TemplateSkill { name: "原生开发".into(), importance: 5, children: vec!["Swift/Kotlin".into(), "UI 组件".into(), "生命周期".into()] },
                TemplateSkill { name: "跨平台框架".into(), importance: 5, children: vec!["React Native".into(), "Flutter".into(), "性能调优".into()] },
                TemplateSkill { name: "移动端架构".into(), importance: 4, children: vec!["MVVM".into(), "状态管理".into(), "离线存储".into()] },
                TemplateSkill { name: "性能优化".into(), importance: 4, children: vec!["启动优化".into(), "内存管理".into(), "包体积优化".into()] },
                TemplateSkill { name: "发布运维".into(), importance: 3, children: vec!["热更新".into(), "崩溃监控".into(), "应用商店".into()] },
            ],
        },
        CareerTemplate {
            id: "security".into(),
            name: "安全工程师".into(),
            description: "网络安全、渗透测试、安全架构".into(),
            skills: vec![
                TemplateSkill { name: "网络安全基础".into(), importance: 5, children: vec!["TCP/IP".into(), "防火墙".into(), "VPN".into()] },
                TemplateSkill { name: "Web 安全".into(), importance: 5, children: vec!["XSS/CSRF".into(), "SQL 注入".into(), "OWASP Top 10".into()] },
                TemplateSkill { name: "渗透测试".into(), importance: 4, children: vec!["漏洞扫描".into(), "社工攻击".into(), "红蓝对抗".into()] },
                TemplateSkill { name: "安全运营".into(), importance: 4, children: vec!["SIEM".into(), "应急响应".into(), "安全审计".into()] },
                TemplateSkill { name: "密码学".into(), importance: 3, children: vec!["加密算法".into(), "PKI".into(), "零信任".into()] },
            ],
        },
        CareerTemplate {
            id: "data_engineer".into(),
            name: "数据工程师".into(),
            description: "大数据平台、ETL、数据仓库".into(),
            skills: vec![
                TemplateSkill { name: "数据仓库".into(), importance: 5, children: vec!["维度建模".into(), "数据分层".into(), "数据质量".into()] },
                TemplateSkill { name: "大数据技术".into(), importance: 5, children: vec!["Spark".into(), "Flink".into(), "Hive".into(), "Kafka".into()] },
                TemplateSkill { name: "ETL 开发".into(), importance: 4, children: vec!["Airflow".into(), "数据清洗".into(), "调度系统".into()] },
                TemplateSkill { name: "SQL".into(), importance: 4, children: vec!["复杂查询".into(), "性能优化".into(), "数据建模".into()] },
                TemplateSkill { name: "云数据平台".into(), importance: 3, children: vec!["Snowflake".into(), "Databricks".into(), "数据湖".into()] },
            ],
        },
        CareerTemplate {
            id: "test_engineer".into(),
            name: "测试工程师".into(),
            description: "质量保障、自动化测试、性能测试".into(),
            skills: vec![
                TemplateSkill { name: "测试理论".into(), importance: 5, children: vec!["测试用例设计".into(), "边界值分析".into(), "等价类划分".into()] },
                TemplateSkill { name: "自动化测试".into(), importance: 5, children: vec!["Selenium/Cypress".into(), "API 测试".into(), "CI 集成".into()] },
                TemplateSkill { name: "性能测试".into(), importance: 4, children: vec!["JMeter".into(), "压力测试".into(), "性能分析".into()] },
                TemplateSkill { name: "测试管理".into(), importance: 3, children: vec!["缺陷管理".into(), "测试计划".into(), "质量报告".into()] },
            ],
        },
        CareerTemplate {
            id: "blockchain".into(),
            name: "区块链开发工程师".into(),
            description: "智能合约、DApp、Web3".into(),
            skills: vec![
                TemplateSkill { name: "区块链原理".into(), importance: 5, children: vec!["共识算法".into(), "加密学".into(), "P2P 网络".into()] },
                TemplateSkill { name: "智能合约".into(), importance: 5, children: vec!["Solidity".into(), "合约安全".into(), "Gas 优化".into()] },
                TemplateSkill { name: "DApp 开发".into(), importance: 4, children: vec!["Web3.js".into(), "钱包集成".into(), "IPFS".into()] },
                TemplateSkill { name: "DeFi/NFT".into(), importance: 3, children: vec!["AMM".into(), "借贷协议".into(), "NFT 标准".into()] },
            ],
        },
        CareerTemplate {
            id: "game_dev".into(),
            name: "游戏开发工程师".into(),
            description: "游戏引擎、图形学、游戏设计".into(),
            skills: vec![
                TemplateSkill { name: "游戏引擎".into(), importance: 5, children: vec!["Unity".into(), "Unreal Engine".into(), "场景管理".into()] },
                TemplateSkill { name: "编程基础".into(), importance: 5, children: vec!["C#/C++".into(), "数据结构".into(), "算法".into()] },
                TemplateSkill { name: "图形学".into(), importance: 4, children: vec!["Shader 编程".into(), "渲染管线".into(), "光照模型".into()] },
                TemplateSkill { name: "游戏设计".into(), importance: 3, children: vec!["关卡设计".into(), "数值平衡".into(), "用户体验".into()] },
            ],
        },
        CareerTemplate {
            id: "marketing".into(),
            name: "数字营销专家".into(),
            description: "增长黑客、内容营销、数据驱动营销".into(),
            skills: vec![
                TemplateSkill { name: "增长策略".into(), importance: 5, children: vec!["获客渠道".into(), "转化优化".into(), "留存策略".into(), "AARRR 模型".into()] },
                TemplateSkill { name: "内容营销".into(), importance: 5, children: vec!["文案写作".into(), "SEO".into(), "社媒运营".into()] },
                TemplateSkill { name: "数据分析".into(), importance: 4, children: vec!["GA/百度统计".into(), "归因分析".into(), "ROI 计算".into()] },
                TemplateSkill { name: "广告投放".into(), importance: 4, children: vec!["SEM".into(), "信息流广告".into(), "素材优化".into()] },
                TemplateSkill { name: "品牌建设".into(), importance: 3, children: vec!["品牌定位".into(), "PR 策略".into(), "社区运营".into()] },
            ],
        },
        CareerTemplate {
            id: "project_manager".into(),
            name: "项目经理".into(),
            description: "项目管理、团队协作、交付保障".into(),
            skills: vec![
                TemplateSkill { name: "项目规划".into(), importance: 5, children: vec!["WBS 分解".into(), "甘特图".into(), "资源规划".into(), "风险管理".into()] },
                TemplateSkill { name: "敏捷管理".into(), importance: 5, children: vec!["Scrum".into(), "看板".into(), "迭代管理".into(), "回顾会".into()] },
                TemplateSkill { name: "沟通协作".into(), importance: 4, children: vec!["干系人管理".into(), "冲突解决".into(), "汇报技巧".into()] },
                TemplateSkill { name: "质量管理".into(), importance: 4, children: vec!["验收标准".into(), "缺陷跟踪".into(), "持续改进".into()] },
                TemplateSkill { name: "工具使用".into(), importance: 3, children: vec!["Jira".into(), "Confluence".into(), "飞书/钉钉".into()] },
            ],
        },
        CareerTemplate {
            id: "embedded".into(),
            name: "嵌入式开发工程师".into(),
            description: "MCU/ARM 开发、RTOS、IoT".into(),
            skills: vec![
                TemplateSkill { name: "C/C++".into(), importance: 5, children: vec!["指针/内存管理".into(), "嵌入式 C".into(), "代码优化".into()] },
                TemplateSkill { name: "硬件基础".into(), importance: 5, children: vec!["电路原理".into(), "PCB 设计".into(), "示波器/逻辑分析仪".into()] },
                TemplateSkill { name: "RTOS".into(), importance: 4, children: vec!["FreeRTOS".into(), "任务调度".into(), "中断处理".into()] },
                TemplateSkill { name: "通信协议".into(), importance: 4, children: vec!["SPI/I2C/UART".into(), "CAN 总线".into(), "BLE".into()] },
                TemplateSkill { name: "IoT".into(), importance: 3, children: vec!["MQTT".into(), "边缘计算".into(), "OTA 升级".into()] },
            ],
        },
        CareerTemplate {
            id: "cloud_architect".into(),
            name: "云架构师".into(),
            description: "云原生架构设计与优化".into(),
            skills: vec![
                TemplateSkill { name: "云服务".into(), importance: 5, children: vec!["计算/存储/网络".into(), "多云策略".into(), "成本优化".into()] },
                TemplateSkill { name: "架构设计".into(), importance: 5, children: vec!["微服务架构".into(), "事件驱动".into(), "高可用设计".into()] },
                TemplateSkill { name: "容器编排".into(), importance: 4, children: vec!["Kubernetes".into(), "Service Mesh".into(), "GitOps".into()] },
                TemplateSkill { name: "安全合规".into(), importance: 4, children: vec!["IAM".into(), "网络安全".into(), "合规审计".into()] },
            ],
        },
        CareerTemplate {
            id: "content_creator".into(),
            name: "内容创作者/自媒体".into(),
            description: "视频、文字、直播全方位内容创作".into(),
            skills: vec![
                TemplateSkill { name: "内容策划".into(), importance: 5, children: vec!["选题策划".into(), "内容日历".into(), "热点追踪".into()] },
                TemplateSkill { name: "视频制作".into(), importance: 5, children: vec!["拍摄技巧".into(), "剪辑软件".into(), "封面设计".into()] },
                TemplateSkill { name: "文案写作".into(), importance: 4, children: vec!["标题技巧".into(), "故事叙述".into(), "SEO 写作".into()] },
                TemplateSkill { name: "粉丝运营".into(), importance: 4, children: vec!["社区互动".into(), "涨粉策略".into(), "商业变现".into()] },
                TemplateSkill { name: "数据分析".into(), importance: 3, children: vec!["平台数据".into(), "用户画像".into(), "内容复盘".into()] },
            ],
        },
        CareerTemplate {
            id: "hr".into(),
            name: "人力资源专家".into(),
            description: "招聘、绩效、组织发展".into(),
            skills: vec![
                TemplateSkill { name: "招聘管理".into(), importance: 5, children: vec!["JD 撰写".into(), "面试技巧".into(), "渠道管理".into(), "人才画像".into()] },
                TemplateSkill { name: "绩效管理".into(), importance: 5, children: vec!["OKR/KPI".into(), "绩效面谈".into(), "360 评估".into()] },
                TemplateSkill { name: "组织发展".into(), importance: 4, children: vec!["组织架构".into(), "文化建设".into(), "人才梯队".into()] },
                TemplateSkill { name: "劳动法规".into(), importance: 4, children: vec!["劳动合同".into(), "社保公积金".into(), "劳动仲裁".into()] },
                TemplateSkill { name: "培训发展".into(), importance: 3, children: vec!["培训体系".into(), "新人融入".into(), "领导力发展".into()] },
            ],
        },
    ]
}

/// 列出所有职业模板
#[tauri::command]
pub fn list_career_templates() -> Result<Vec<CareerTemplate>, String> {
    Ok(build_templates())
}

// ============================================================
// 2. AI Onboarding — 根据职业描述生成技能树 + 首周计划
// ============================================================

/// 检查是否需要 onboarding（首次使用检测）
#[tauri::command]
pub fn check_needs_onboarding() -> Result<bool, String> {
    let conn = open_db()?;
    let skill_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM industry_skill", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let has_onboarded = crate::db::kv_get(&conn, "onboarded")?;
    Ok(skill_count == 0 && has_onboarded.is_none())
}

/// 标记已完成 onboarding
#[tauri::command]
pub fn mark_onboarded() -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "INSERT INTO app_kv(key, val) VALUES('onboarded', '1')
         ON CONFLICT(key) DO UPDATE SET val=excluded.val",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 从模板应用职业技能树 + 自动生成首周计划
#[tauri::command]
pub fn apply_career_template(template_id: String) -> Result<Vec<IndustryNode>, String> {
    let templates = build_templates();
    let tpl = templates
        .iter()
        .find(|t| t.id == template_id)
        .ok_or_else(|| format!("模板不存在: {}", template_id))?;

    let mut conn = open_db()?;
    conn.execute("PRAGMA foreign_keys = ON;", [])
        .map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // Create root node for career
    let root_name = tpl.name.clone();
    tx.execute(
        "INSERT OR IGNORE INTO industry_skill (name, parent_id, required_level, importance) VALUES (?1, NULL, 100, 1.0)",
        rusqlite::params![&root_name],
    ).map_err(|e| e.to_string())?;
    let root_id: i64 = tx
        .query_row(
            "SELECT id FROM industry_skill WHERE name=?1 AND parent_id IS NULL",
            [&root_name],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    // Create skill categories and children
    let today = Local::now().date_naive();
    let mut task_slot = 0usize;

    for skill in &tpl.skills {
        tx.execute(
            "INSERT OR IGNORE INTO industry_skill (name, parent_id, required_level, importance) VALUES (?1, ?2, 3, ?3)",
            rusqlite::params![&skill.name, root_id, skill.importance],
        ).map_err(|e| e.to_string())?;

        let skill_id: i64 = tx
            .query_row(
                "SELECT id FROM industry_skill WHERE name=?1 AND parent_id=?2",
                rusqlite::params![&skill.name, root_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;

        for child_name in &skill.children {
            tx.execute(
                "INSERT OR IGNORE INTO industry_skill (name, parent_id, required_level, importance) VALUES (?1, ?2, 3, 3)",
                rusqlite::params![child_name, skill_id],
            ).map_err(|e| e.to_string())?;
        }

        // Auto-generate first week plan task for top skills
        if skill.importance >= 4 {
            let due = today + Duration::days(task_slot as i64);
            let due_str = due.format("%Y-%m-%d").to_string();
            let title = format!("学习 {} 基础概念", skill.name);

            let exists: Option<i64> = tx
                .query_row(
                    "SELECT id FROM plan_task WHERE horizon='WEEK' AND skill_id=?1 AND status<>'DONE' LIMIT 1",
                    rusqlite::params![skill_id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;

            if exists.is_none() {
                tx.execute(
                    "INSERT INTO plan_task (horizon, skill_id, title, minutes, due, status)
                     VALUES ('WEEK', ?1, ?2, 60, ?3, 'TODO')",
                    rusqlite::params![skill_id, &title, &due_str],
                )
                .map_err(|e| e.to_string())?;
            }
            task_slot = (task_slot + 1) % 7;
        }
    }

    // Save career goal
    tx.execute(
        "INSERT INTO app_kv(key, val) VALUES('career_goal', ?1)
         ON CONFLICT(key) DO UPDATE SET val=excluded.val",
        rusqlite::params![&root_name],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    // Return full tree
    crate::tree::list_industry_tree_v1()
}

/// AI 生成自定义职业的技能树（非模板）
#[tauri::command]
pub fn ai_generate_career_tree(career: String) -> Result<Vec<IndustryNode>, String> {
    let conn = open_db()?;
    let cfg = crate::db::read_ai_config(&conn)?;
    let api_base = cfg.get("api_base").cloned().unwrap_or_default();
    let api_key = cfg.get("api_key").cloned().unwrap_or_default();
    let model = cfg
        .get("model")
        .cloned()
        .unwrap_or_else(|| crate::models::DEFAULT_MODEL.to_string());

    if api_base.trim().is_empty() || api_key.trim().is_empty() {
        return Err("AI 配置缺失，请先配置 api_base 和 api_key".into());
    }

    let url = format!("{}/v1/chat/completions", api_base.trim_end_matches('/'));

    let sys = format!(
        "你是一个职业成长教练。用户告诉你他的职业目标，你需要为他生成一棵完整的技能树。\
要求：\n\
1. 生成 5-8 个一级技能分类\n\
2. 每个一级技能下有 3-5 个具体子技能\n\
3. 为每个一级技能标注重要性 (1-5)\n\
输出严格 JSON：\
{{\"career\":\"职业名称\",\"skills\":[{{\"name\":\"技能名\",\"importance\":5,\"children\":[\"子技能1\",\"子技能2\"]}},...]}}\n\
只输出 JSON，不要任何解释。"
    );

    let usr = format!("我的职业目标是：{}", career);

    let payload = serde_json::json!({
        "model": model,
        "temperature": 0.3,
        "response_format": { "type": "json_object" },
        "messages": [
            {"role": "system", "content": sys},
            {"role": "user", "content": usr}
        ]
    });

    let resp = ureq::post(&url)
        .set("Authorization", &format!("Bearer {}", api_key))
        .set("Content-Type", "application/json")
        .send_json(payload)
        .map_err(|e| format!("AI 调用失败: {e}"))?;

    if resp.status() >= 300 {
        return Err(format!("AI HTTP {}", resp.status()));
    }

    let resp_body: crate::models::ChatCompletionResponse = resp
        .into_json()
        .map_err(|e| format!("解析 AI 响应失败: {e}"))?;
    let content = resp_body
        .choices
        .first()
        .and_then(|c| c.message.content.as_deref())
        .ok_or("AI 未返回有效内容")?;

    let parsed: serde_json::Value =
        serde_json::from_str(content).map_err(|e| format!("AI JSON 解析失败: {e}"))?;

    let career_name = parsed["career"]
        .as_str()
        .unwrap_or(&career)
        .trim()
        .to_string();
    let skills_arr = parsed["skills"]
        .as_array()
        .ok_or("AI 未返回 skills 数组")?;

    // Write to DB
    drop(conn);
    let mut conn = open_db()?;
    conn.execute("PRAGMA foreign_keys = ON;", [])
        .map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // Create root
    tx.execute(
        "INSERT OR IGNORE INTO industry_skill (name, parent_id, required_level, importance) VALUES (?1, NULL, 100, 1.0)",
        rusqlite::params![&career_name],
    ).map_err(|e| e.to_string())?;
    let root_id: i64 = tx
        .query_row(
            "SELECT id FROM industry_skill WHERE name=?1 AND parent_id IS NULL",
            [&career_name],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    let today = Local::now().date_naive();
    let mut task_slot = 0usize;
    let mut seen = HashSet::<String>::new();

    for item in skills_arr {
        let name = item["name"].as_str().unwrap_or("").trim().to_string();
        if name.is_empty() || seen.contains(&name.to_lowercase()) {
            continue;
        }
        seen.insert(name.to_lowercase());

        let importance = item["importance"].as_i64().unwrap_or(3).clamp(1, 5);

        tx.execute(
            "INSERT OR IGNORE INTO industry_skill (name, parent_id, required_level, importance) VALUES (?1, ?2, 3, ?3)",
            rusqlite::params![&name, root_id, importance],
        ).map_err(|e| e.to_string())?;

        let skill_id: i64 = tx
            .query_row(
                "SELECT id FROM industry_skill WHERE name=?1 AND parent_id=?2",
                rusqlite::params![&name, root_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;

        if let Some(children) = item["children"].as_array() {
            for child in children {
                if let Some(cn) = child.as_str() {
                    let cn = cn.trim();
                    if !cn.is_empty() {
                        tx.execute(
                            "INSERT OR IGNORE INTO industry_skill (name, parent_id, required_level, importance) VALUES (?1, ?2, 3, 3)",
                            rusqlite::params![cn, skill_id],
                        ).map_err(|e| e.to_string())?;
                    }
                }
            }
        }

        // Generate first week plan for important skills
        if importance >= 4 {
            let due = today + Duration::days(task_slot as i64);
            let due_str = due.format("%Y-%m-%d").to_string();
            let title = format!("学习 {} 基础概念", name);

            let exists: Option<i64> = tx
                .query_row(
                    "SELECT id FROM plan_task WHERE horizon='WEEK' AND skill_id=?1 AND status<>'DONE' LIMIT 1",
                    rusqlite::params![skill_id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;

            if exists.is_none() {
                tx.execute(
                    "INSERT INTO plan_task (horizon, skill_id, title, minutes, due, status)
                     VALUES ('WEEK', ?1, ?2, 60, ?3, 'TODO')",
                    rusqlite::params![skill_id, &title, &due_str],
                )
                .map_err(|e| e.to_string())?;
            }
            task_slot = (task_slot + 1) % 7;
        }
    }

    // Save career goal
    tx.execute(
        "INSERT INTO app_kv(key, val) VALUES('career_goal', ?1)
         ON CONFLICT(key) DO UPDATE SET val=excluded.val",
        rusqlite::params![&career_name],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    crate::tree::list_industry_tree_v1()
}

// ============================================================
// 3. Skill Progress — 技能进度查询
// ============================================================

#[derive(serde::Serialize)]
pub struct SkillProgress {
    pub skill_id: i64,
    pub skill_name: String,
    pub total_tasks: i64,
    pub done_tasks: i64,
    pub note_count: i64,
    /// 0.0 ~ 1.0
    pub progress: f64,
}

/// 获取所有技能的学习进度
#[tauri::command]
pub fn list_skill_progress() -> Result<Vec<SkillProgress>, String> {
    let conn = open_db()?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
                s.id,
                s.name,
                COALESCE(t.total, 0) as total_tasks,
                COALESCE(t.done, 0) as done_tasks,
                COALESCE(n.cnt, 0) as note_count
            FROM industry_skill s
            LEFT JOIN (
                SELECT skill_id,
                       COUNT(*) as total,
                       SUM(CASE WHEN status='DONE' THEN 1 ELSE 0 END) as done
                FROM plan_task
                WHERE skill_id IS NOT NULL
                GROUP BY skill_id
            ) t ON t.skill_id = s.id
            LEFT JOIN (
                SELECT skill_id, COUNT(*) as cnt
                FROM note_skill_map
                GROUP BY skill_id
            ) n ON n.skill_id = s.id
            WHERE s.parent_id IS NOT NULL
            ORDER BY s.id
            "#,
        )
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let total: i64 = row.get(2).map_err(|e| e.to_string())?;
        let done: i64 = row.get(3).map_err(|e| e.to_string())?;
        let notes: i64 = row.get(4).map_err(|e| e.to_string())?;

        // Progress = weighted combo of task completion + note activity
        let task_progress = if total > 0 {
            done as f64 / total as f64
        } else {
            0.0
        };
        let note_signal = (notes as f64 / 5.0).min(1.0); // 5 notes = max signal
        let progress = (task_progress * 0.7 + note_signal * 0.3).min(1.0);

        out.push(SkillProgress {
            skill_id: row.get(0).map_err(|e| e.to_string())?,
            skill_name: row.get(1).map_err(|e| e.to_string())?,
            total_tasks: total,
            done_tasks: done,
            note_count: notes,
            progress,
        });
    }
    Ok(out)
}

// ============================================================
// 4. AI Coach Report — AI 教练式周报
// ============================================================

/// AI 教练生成周度评价和建议
#[tauri::command]
pub fn ai_coach_weekly_report() -> Result<String, String> {
    let conn = open_db()?;

    // Gather week data
    let end = Local::now().date_naive();
    let start = end - Duration::days(6);
    let start_s = start.format("%Y-%m-%d").to_string();
    let end_s = end.format("%Y-%m-%d").to_string();

    let (tasks_done, minutes_done): (i64, i64) = conn
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(minutes),0) FROM plan_task WHERE status='DONE' AND due IS NOT NULL AND due >= ?1 AND due <= ?2",
            rusqlite::params![&start_s, &end_s],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    let tasks_pending: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM plan_task WHERE status='TODO' AND due IS NOT NULL AND due <= ?1",
            [&end_s],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    let new_notes: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM notes WHERE datetime(created_at) >= datetime(?1 || 'T00:00:00Z')",
            [&start_s],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    // Gather overdue tasks
    let mut stmt = conn
        .prepare(
            "SELECT title, due FROM plan_task WHERE status='TODO' AND due IS NOT NULL AND due < ?1 ORDER BY due ASC LIMIT 5",
        )
        .map_err(|e| e.to_string())?;
    let mut overdue_buf = String::new();
    let mut rows = stmt
        .query(rusqlite::params![&start_s])
        .map_err(|e| e.to_string())?;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let title: String = row.get(0).map_err(|e| e.to_string())?;
        let due: String = row.get(1).map_err(|e| e.to_string())?;
        overdue_buf.push_str(&format!("- {}（截止: {}）\n", title, due));
    }
    drop(rows);
    drop(stmt);

    // Get career goal
    let career_goal = crate::db::kv_get(&conn, "career_goal")?.unwrap_or_default();

    // Build AI prompt
    let cfg = crate::db::read_ai_config(&conn)?;
    let api_base = cfg.get("api_base").cloned().unwrap_or_default();
    let api_key = cfg.get("api_key").cloned().unwrap_or_default();
    let model = cfg
        .get("model")
        .cloned()
        .unwrap_or_else(|| crate::models::DEFAULT_MODEL.to_string());

    if api_base.trim().is_empty() || api_key.trim().is_empty() {
        // Fall back to a non-AI report
        let mut report = format!(
            "## 本周学习报告 ({} ~ {})\n\n",
            start_s, end_s
        );
        report.push_str(&format!("**完成任务**: {} 项\n", tasks_done));
        report.push_str(&format!("**学习时间**: {} 分钟\n", minutes_done));
        report.push_str(&format!("**新增笔记**: {} 篇\n", new_notes));
        report.push_str(&format!("**待办积压**: {} 项\n\n", tasks_pending));
        if !overdue_buf.is_empty() {
            report.push_str("**逾期任务**:\n");
            report.push_str(&overdue_buf);
        }
        report.push_str("\n> 配置 AI 后可获得个性化教练建议。");
        return Ok(report);
    }

    let url = format!("{}/v1/chat/completions", api_base.trim_end_matches('/'));

    let sys = "你是一个温暖但直率的职业成长教练。根据用户本周的学习数据，用教练的口吻给出：\n\
1. 一句话总评（鼓励或提醒）\n\
2. 本周亮点（做得好的地方）\n\
3. 需要改进的地方\n\
4. 下周建议（2-3 条具体建议）\n\n\
用 Markdown 格式输出，口语化、有温度，不要太长。";

    let user_msg = format!(
        "职业目标: {}\n本周数据:\n- 完成任务: {} 项\n- 学习时间: {} 分钟\n- 新增笔记: {} 篇\n- 待办积压: {} 项\n{}",
        if career_goal.is_empty() { "未设置" } else { &career_goal },
        tasks_done,
        minutes_done,
        new_notes,
        tasks_pending,
        if overdue_buf.is_empty() { "无逾期任务".to_string() } else { format!("逾期任务:\n{}", overdue_buf) }
    );

    let payload = serde_json::json!({
        "model": model,
        "temperature": 0.5,
        "messages": [
            {"role": "system", "content": sys},
            {"role": "user", "content": user_msg}
        ]
    });

    let resp = ureq::post(&url)
        .set("Authorization", &format!("Bearer {}", api_key))
        .set("Content-Type", "application/json")
        .send_json(payload)
        .map_err(|e| format!("AI 调用失败: {e}"))?;

    if resp.status() >= 300 {
        return Err(format!("AI HTTP {}", resp.status()));
    }

    let resp_body: crate::models::ChatCompletionResponse = resp
        .into_json()
        .map_err(|e| format!("解析 AI 响应失败: {e}"))?;
    let content = resp_body
        .choices
        .first()
        .and_then(|c| c.message.content.as_deref())
        .unwrap_or("无法生成报告")
        .to_string();

    Ok(content)
}

/// 获取用户职业目标
#[tauri::command]
pub fn get_career_goal() -> Result<String, String> {
    let conn = open_db()?;
    Ok(crate::db::kv_get(&conn, "career_goal")?.unwrap_or_default())
}

/// 设置用户职业目标
#[tauri::command]
pub fn set_career_goal(goal: String) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "INSERT INTO app_kv(key, val) VALUES('career_goal', ?1)
         ON CONFLICT(key) DO UPDATE SET val=excluded.val",
        rusqlite::params![goal],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
