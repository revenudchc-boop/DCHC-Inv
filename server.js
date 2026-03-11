// ===============================================
// سيرفر الفواتير المتكامل - الإصدار النهائي
// مع دعم CORS الكامل ومعالجة أخطاء XML
// ===============================================

// استيراد المكتبات المطلوبة
const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const xml2js = require('xml2js');

// إنشاء تطبيق Express
const app = express();
const PORT = 3000;

// ===============================================
// إعدادات CORS الكامل - هذا هو الحل
// ===============================================
app.use((req, res, next) => {
    // السماح لجميع المواقع بالاتصال
    res.setHeader('Access-Control-Allow-Origin', '*');
    // السماح بجميع أنواع الطلبات
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    // السماح بجميع الهيدرات
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');
    // السماح بإرسال الكوكيز
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    // معالجة طلبات OPTIONS (preflight)
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    
    next();
});

// زيادة حجم الملفات المسموح بها
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.raw({ type: 'application/xml', limit: '50mb' }));
app.use(express.text({ type: 'text/xml', limit: '50mb' }));

// خدمة الملفات الثابتة
app.use(express.static(__dirname));

// Middleware لتسجيل الطلبات
app.use((req, res, next) => {
    console.log(`${new Date().toLocaleTimeString('ar-EG')} - ${req.method} ${req.url}`);
    next();
});

// ===============================================
// المسارات والإعدادات
// ===============================================
const LOCAL_DATA_FILE = path.join(__dirname, 'invoices.json');
let localInvoices = [];

// تحميل الفواتير المحلية
function loadLocalInvoices() {
    try {
        if (fs.existsSync(LOCAL_DATA_FILE)) {
            const data = fs.readFileSync(LOCAL_DATA_FILE, 'utf8');
            localInvoices = JSON.parse(data);
            console.log(`✅ تم تحميل ${localInvoices.length} فاتورة من الملف المحلي`);
        }
    } catch (error) {
        console.log('⚠️ لا يوجد ملف فواتير محلي');
        localInvoices = [];
    }
}

// حفظ الفواتير محلياً
function saveLocalInvoices(invoices) {
    try {
        localInvoices = invoices;
        fs.writeFileSync(LOCAL_DATA_FILE, JSON.stringify(invoices, null, 2));
        console.log(`✅ تم حفظ ${invoices.length} فاتورة محلياً`);
        return true;
    } catch (error) {
        console.error('❌ خطأ في حفظ الفواتير:', error.message);
        return false;
    }
}

// ===============================================
// دوال تحليل XML - الحل لمشكلة & والأحرف الخاصة
// ===============================================

/**
 * دالة بديلة باستخدام Regex (وهي التي حلّت المشكلة سابقاً)
 */
function parseXMLWithRegex(xmlData) {
    try {
        console.log('🔍 جاري استخراج البيانات باستخدام Regex...');
        
        // استخراج أسماء الأعمدة
        const columnsMatch = xmlData.match(/<columns>([\s\S]*?)<\/columns>/);
        const columnNames = [];
        
        if (columnsMatch) {
            const colRegex = /<column>(.*?)<\/column>/g;
            let colMatch;
            while ((colMatch = colRegex.exec(columnsMatch[1])) !== null) {
                columnNames.push(colMatch[1]);
            }
            console.log(`📋 تم العثور على ${columnNames.length} عمود`);
        }
        
        // استخراج الصفوف
        const rowRegex = /<row\s+primary-key="(\d+)"\s*>([\s\S]*?)<\/row>/g;
        const fieldRegex = /<field>([\s\S]*?)<\/field>/g;
        
        const invoices = [];
        let rowMatch;
        let skippedRows = 0;
        
        while ((rowMatch = rowRegex.exec(xmlData)) !== null) {
            try {
                const primaryKey = rowMatch[1];
                const rowContent = rowMatch[2];
                
                // استخراج الحقول
                const fields = [];
                let fieldMatch;
                while ((fieldMatch = fieldRegex.exec(rowContent)) !== null) {
                    // تنظيف القيمة من أي أحرف خاصة
                    let fieldValue = fieldMatch[1]
                        .replace(/&amp;/g, '&')
                        .replace(/&lt;/g, '<')
                        .replace(/&gt;/g, '>')
                        .replace(/&quot;/g, '"')
                        .replace(/&#39;/g, "'")
                        .trim();
                    
                    fields.push(fieldValue);
                }
                
                // بناء الفاتورة
                const invoice = {
                    id: primaryKey,
                    data: {}
                };
                
                columnNames.forEach((colName, idx) => {
                    if (idx < fields.length) {
                        invoice.data[colName] = fields[idx] || '';
                    }
                });
                
                invoices.push(invoice);
                
            } catch (rowError) {
                skippedRows++;
            }
        }
        
        console.log(`✅ تم استخراج ${invoices.length} فاتورة باستخدام Regex`);
        return invoices;
        
    } catch (error) {
        console.error('❌ فشل Regex:', error.message);
        return [];
    }
}

/**
 * تحويل XML من API إلى JSON - نسخة محسنة تتجاهل الأخطاء
 */
async function parseXMLFromAPI(xmlData) {
    try {
        console.log('🔄 جاري تنظيف وتحليل XML...');
        
        // تنظيف البيانات من الأحرف غير الصالحة
        let cleanedData = xmlData;
        cleanedData = cleanedData.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;');
        
        // محاولة التحليل بالطريقة العادية
        try {
            const parser = new xml2js.Parser({
                explicitArray: false,
                explicitRoot: false,
                mergeAttrs: true,
                trim: true,
                strict: false
            });
            
            const result = await parser.parseStringPromise(cleanedData);
            
            // استخراج البيانات
            let invoices = [];
            const root = result['query-response'] || result;
            const dataTable = root['data-table'] || root;
            
            if (dataTable && dataTable.rows && dataTable.rows.row) {
                const rows = Array.isArray(dataTable.rows.row) ? dataTable.rows.row : [dataTable.rows.row];
                const columns = dataTable.columns?.column ? 
                    (Array.isArray(dataTable.columns.column) ? dataTable.columns.column : [dataTable.columns.column]) : [];
                
                invoices = rows.map((row, index) => {
                    const invoice = { id: row.$?.['primary-key'] || `row-${index}`, data: {} };
                    if (row.field) {
                        const fields = Array.isArray(row.field) ? row.field : [row.field];
                        columns.forEach((colName, idx) => {
                            if (idx < fields.length) invoice.data[colName] = fields[idx] || '';
                        });
                    }
                    return invoice;
                });
            }
            
            if (invoices.length > 0) return invoices;
            throw new Error('لم يتم العثور على فواتير');
            
        } catch (parseError) {
            console.log('⚠️ فشل التحليل العادي، جاري استخدام Regex...');
            return parseXMLWithRegex(cleanedData);
        }
        
    } catch (error) {
        console.error('❌ خطأ في تحليل XML:', error.message);
        return parseXMLWithRegex(xmlData);
    }
}

// تحميل البيانات عند بدء التشغيل
loadLocalInvoices();

// ===============================================
// نقاط النهاية
// ===============================================

// اختبار الاتصال
app.get('/api/test', (req, res) => {
    res.json({ success: true, message: 'السيرفر يعمل', time: new Date() });
});

// رفع ملف XML
app.post('/api/connection/upload-xml', async (req, res) => {
    try {
        let xmlData = '';
        if (Buffer.isBuffer(req.body)) {
            xmlData = req.body.toString('utf8');
        } else if (typeof req.body === 'string') {
            xmlData = req.body;
        } else {
            xmlData = JSON.stringify(req.body);
        }
        
        if (!xmlData || xmlData.trim() === '') {
            return res.status(400).json({ success: false, error: 'الملف فارغ' });
        }
        
        console.log(`📄 حجم الملف: ${(xmlData.length / 1024).toFixed(2)} كيلوبايت`);
        
        const invoices = await parseXMLFromAPI(xmlData);
        
        if (invoices.length > 0) {
            saveLocalInvoices(invoices);
            res.json({
                success: true,
                message: `✅ تم رفع ${invoices.length} فاتورة`,
                count: invoices.length,
                invoices: invoices.slice(0, 5)
            });
        } else {
            res.status(400).json({ success: false, error: 'لم يتم العثور على فواتير' });
        }
        
    } catch (error) {
        console.error('❌ خطأ:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// جلب الفواتير
app.get('/api/invoices', (req, res) => {
    res.json({
        success: true,
        count: localInvoices.length,
        data: localInvoices
    });
});

// فحص الصحة
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        time: new Date(),
        invoices: localInvoices.length,
        cors: 'enabled'
    });
});

// الصفحة الرئيسية
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ===============================================
// تشغيل السيرفر
// ===============================================
app.listen(PORT, () => {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 سيرفر الفواتير يعمل بنجاح');
    console.log('='.repeat(60));
    console.log(`📍 العنوان: http://localhost:${PORT}`);
    console.log(`📊 الفواتير: ${localInvoices.length}`);
    console.log('='.repeat(60));
    console.log('📡 نقاط API:');
    console.log('   POST /api/connection/upload-xml - رفع ملف');
    console.log('   GET  /api/invoices              - الفواتير');
    console.log('   GET  /health                     - فحص الصحة');
    console.log('='.repeat(60) + '\n');
});