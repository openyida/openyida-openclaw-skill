const _customState = {
  name: '',
  phone: '',
  company: '',
  message: '',
  submitted: false,
};

export function getCustomState(key) {
  if (key) {
    return _customState[key];
  }
  return { ..._customState };
}

// 注意：所有 export function 中的 this 均由宜搭平台绑定为页面 React 类实例，
// 通过 self.setCustomState() / self.forceUpdate() 等方式调用时 this 指向正确。

export function setCustomState(newState) {
  Object.keys(newState).forEach(function(key) {
    _customState[key] = newState[key];
  });
  // this 由宜搭平台绑定，调用导出的 forceUpdate 函数触发重新渲染
  this.forceUpdate();
}

export function forceUpdate() {
  // 通过更新 timestamp 触发 React 重渲染
  this.setState({ timestamp: new Date().getTime() });
}

export function didMount() {
  // 页面加载完成后的初始化逻辑（如有需要可在此处加载数据）
}

export function didUnmount() {
  // 页面卸载时的清理逻辑（如有定时器需在此处清除）
}

export function renderJsx() {
  const { timestamp } = this.state;
  const self = this;

  const styles = {
    wrapper: {
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      padding: '40px',
      maxWidth: '600px',
      margin: '0 auto',
    },
    title: {
      fontSize: '24px',
      fontWeight: '600',
      marginBottom: '24px',
      textAlign: 'center',
    },
    formGroup: {
      marginBottom: '16px',
    },
    label: {
      display: 'block',
      fontSize: '14px',
      fontWeight: '500',
      marginBottom: '8px',
    },
    input: {
      width: '100%',
      padding: '12px',
      fontSize: '16px',
      border: '1px solid #ddd',
      borderRadius: '4px',
      boxSizing: 'border-box',
    },
    textarea: {
      width: '100%',
      padding: '12px',
      fontSize: '16px',
      border: '1px solid #ddd',
      borderRadius: '4px',
      minHeight: '100px',
      boxSizing: 'border-box',
      fontFamily: 'inherit',
    },
    button: {
      width: '100%',
      padding: '14px',
      fontSize: '16px',
      fontWeight: '600',
      color: '#fff',
      background: '#1890ff',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      marginTop: '16px',
    },
    successBox: {
      textAlign: 'center',
      padding: '60px 20px',
    },
    successIcon: {
      fontSize: '48px',
      marginBottom: '16px',
    },
    successTitle: {
      fontSize: '20px',
      fontWeight: '600',
      marginBottom: '8px',
    },
  };

  const handleSubmit = () => {
    const name = _customState.name;
    const phone = _customState.phone;

    if (!name || !phone) {
      self.utils.toast({ title: '请填写姓名和联系电话', type: 'warn' });
      return;
    }

    const formUuid = 'FORM_YOUR_FORM_UUID';
    const appType = window.pageConfig.appType;

    self.utils.yida.saveFormData({
      formUuid: formUuid,
      appType: appType,
      formDataJson: JSON.stringify({
        textField_name: _customState.name,
        textField_phone: _customState.phone,
        textField_company: _customState.company,
        textareaField_message: _customState.message,
      })
    }).then(function(res) {
      self.utils.toast({ title: '提交成功！', type: 'success' });
      self.setCustomState({ submitted: true });
    }).catch(function(err) {
      self.utils.toast({ title: '提交失败: ' + err.message, type: 'error' });
    });
  };

  if (_customState.submitted) {
    return (
      <div style={styles.wrapper}>
        <div style={{ display: 'none' }}>{timestamp}</div>
        <div style={styles.successBox}>
          <div style={styles.successIcon}>✓</div>
          <div style={styles.successTitle}>提交成功！</div>
          <p>感谢您的留言，我们会尽快与您联系。</p>
          <button 
            style={{...styles.button, background: '#666'}}
            onClick={function() {
              self.setCustomState({ 
                submitted: false, 
                name: '', 
                phone: '', 
                company: '', 
                message: '' 
              });
            }}
          >
            继续留言
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.wrapper}>
      <div style={{ display: 'none' }}>{timestamp}</div>
      
      <h1 style={styles.title}>联系我们</h1>
      <p style={{textAlign: 'center', color: '#666', marginBottom: '24px'}}>
        留下您的信息，我们会尽快与您联系
      </p>

      <div style={styles.formGroup}>
        <label style={styles.label}>姓名 *</label>
        <input 
          style={styles.input}
          placeholder="请输入姓名"
          defaultValue=""
          onChange={function(e) { _customState.name = e.target.value; }}
        />
      </div>

      <div style={styles.formGroup}>
        <label style={styles.label}>联系电话 *</label>
        <input 
          style={styles.input}
          placeholder="请输入联系电话"
          defaultValue=""
          onChange={function(e) { _customState.phone = e.target.value; }}
        />
      </div>

      <div style={styles.formGroup}>
        <label style={styles.label}>公司名称</label>
        <input 
          style={styles.input}
          placeholder="请输入公司名称（选填）"
          defaultValue=""
          onChange={function(e) { _customState.company = e.target.value; }}
        />
      </div>

      <div style={styles.formGroup}>
        <label style={styles.label}>留言内容</label>
        <textarea 
          style={styles.textarea}
          placeholder="请输入留言内容（选填）"
          defaultValue=""
          onChange={function(e) { _customState.message = e.target.value; }}
        ></textarea>
      </div>

      <button style={styles.button} onClick={handleSubmit}>提交</button>
    </div>
  );
}
