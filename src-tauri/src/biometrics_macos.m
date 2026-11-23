#import <Foundation/Foundation.h>
#import <LocalAuthentication/LocalAuthentication.h>

bool teledrive_can_authenticate_biometrics(int *out_biometry_type) {
    @autoreleasepool {
        LAContext *context = [[LAContext alloc] init];
        NSError *error = nil;
        // LAPolicyDeviceOwnerAuthentication checks for biometrics OR device passcode
        BOOL canAuth = [context canEvaluatePolicy:LAPolicyDeviceOwnerAuthentication error:&error];
        if (out_biometry_type) {
            if (@available(macOS 10.15, *)) {
                *out_biometry_type = (int)context.biometryType;
            } else {
                *out_biometry_type = 0;
            }
        }
        return canAuth;
    }
}

bool teledrive_authenticate_device_owner(const char *reason_utf8) {
    @autoreleasepool {
        LAContext *context = [[LAContext alloc] init];
        NSString *reason = reason_utf8 ? [NSString stringWithUTF8String:reason_utf8] : @"Unlock TeleDrive";
        
        dispatch_semaphore_t sem = dispatch_semaphore_create(0);
        __block BOOL authSuccess = NO;
        
        [context evaluatePolicy:LAPolicyDeviceOwnerAuthentication
                localizedReason:reason
                          reply:^(BOOL success, __unused NSError *error) {
            authSuccess = success;
            dispatch_semaphore_signal(sem);
        }];
        
        // Wait for user to interact with the biometric or password prompt
        dispatch_semaphore_wait(sem, DISPATCH_TIME_FOREVER);
        return authSuccess;
    }
}
